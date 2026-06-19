/**
 * Pure JSON / YAML validation + autofix for issue #93.
 *
 * Snakie opens config-style files (`.json`, `.yml`, `.yaml`) alongside Python.
 * This module validates their syntax and, when possible, offers an autofix —
 * entirely in the renderer with no host round-trip, mirroring the plugin lint
 * path that produces {@link Diagnostic}s for the editor squiggles + Problems
 * panel.
 *
 * Two entry points, both PURE (no Monaco/instance state, unit-tested in
 * test/formatValidate.test.ts):
 *
 *  - {@link validateFormat}(name, content): map a parse failure to a 1-based
 *    {@link Diagnostic} (line/column derived from the engine's error position).
 *    Returns `[]` for valid content OR an unsupported extension.
 *  - {@link autofixFormat}(name, content): return a canonical, re-formatted
 *    string when one can be produced safely (the result must itself parse), or
 *    `null` when no safe fix is available.
 *
 * JSON uses the built-in `JSON.parse`; YAML uses the `yaml` package's
 * `parseDocument`, which collects every error/warning with a line/col range.
 */
import { parseDocument } from 'yaml'
import type { Diagnostic } from '../../../preload/index.d'

/** The kinds of file this module validates. */
export type FormatKind = 'json' | 'yaml'

/** Source label shown on diagnostics + Problems rows for this validator. */
const JSON_SOURCE = 'json'
const YAML_SOURCE = 'yaml'

/**
 * Classify a file name by extension. Returns the {@link FormatKind} or `null`
 * for anything this module does not handle (so callers no-op on `.py`, `.md`,
 * etc).
 */
export function formatKindForName(name: string): FormatKind | null {
  if (/\.json$/i.test(name)) return 'json'
  if (/\.ya?ml$/i.test(name)) return 'yaml'
  return null
}

/** Convert a 0-based character offset into a 1-based {line, column}. */
export function offsetToLineCol(content: string, offset: number): { line: number; column: number } {
  const clamped = Math.max(0, Math.min(offset, content.length))
  let line = 1
  let lineStart = 0
  for (let i = 0; i < clamped; i++) {
    if (content.charCodeAt(i) === 10 /* \n */) {
      line++
      lineStart = i + 1
    }
  }
  return { line, column: clamped - lineStart + 1 }
}

/**
 * Extract a 0-based character offset from a `JSON.parse` `SyntaxError`. V8/Node
 * messages include `... in JSON at position N (line L column C)` or just
 * `at position N`; some engines emit only `line L column C`. Returns the offset
 * when a `position` is present, otherwise `null` (the caller falls back to a
 * line/column match or the start of the file).
 */
export function jsonErrorOffset(message: string): number | null {
  const m = /position (\d+)/i.exec(message)
  return m ? Number(m[1]) : null
}

/**
 * Extract a 1-based {line, column} directly from a `JSON.parse` error message
 * of the form `line L column C` (engines that report line/col but no offset).
 * Returns `null` when the message has no such pair.
 */
export function jsonErrorLineCol(message: string): { line: number; column: number } | null {
  const m = /line (\d+) column (\d+)/i.exec(message)
  return m ? { line: Number(m[1]), column: Number(m[2]) } : null
}

/** Build the single diagnostic describing a JSON/YAML parse failure. */
function makeDiagnostic(
  line: number,
  column: number,
  message: string,
  source: string,
  fixes?: Diagnostic['fixes']
): Diagnostic {
  return { line: Math.max(1, line), column: Math.max(1, column), severity: 'error', message, source, fixes }
}

/**
 * Best-effort cleanup of common, machine-safe JSON mistakes BEFORE re-parsing:
 *  - strip `//` line comments and `/* *\/` block comments (JSONC habit)
 *  - drop trailing commas before `}` / `]`
 *
 * String contents are preserved (the scanner tracks whether it is inside a
 * string + escapes), so a `//` or comma inside `"..."` is left untouched. This
 * is only ever used to *attempt* a fix — the result is re-parsed and discarded
 * unless it is valid JSON.
 */
export function stripJsonNoise(content: string): string {
  let out = ''
  let inString = false
  let escaped = false
  for (let i = 0; i < content.length; i++) {
    const c = content[i]
    const next = content[i + 1]
    if (inString) {
      out += c
      if (escaped) escaped = false
      else if (c === '\\') escaped = true
      else if (c === '"') inString = false
      continue
    }
    if (c === '"') {
      inString = true
      out += c
      continue
    }
    if (c === '/' && next === '/') {
      // Line comment: skip to end of line (keep the newline).
      while (i < content.length && content[i] !== '\n') i++
      if (i < content.length) out += '\n'
      continue
    }
    if (c === '/' && next === '*') {
      // Block comment: skip to closing */.
      i += 2
      while (i < content.length && !(content[i] === '*' && content[i + 1] === '/')) i++
      i++ // land on '/', loop's i++ moves past it
      continue
    }
    out += c
  }
  // Drop trailing commas: a comma followed only by whitespace then } or ].
  return out.replace(/,(\s*[}\]])/g, '$1')
}

/** Validate JSON content; returns a single-error diagnostic list or `[]`. */
function validateJson(content: string): Diagnostic[] {
  if (content.trim() === '') return []
  try {
    JSON.parse(content)
    return []
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const offset = jsonErrorOffset(message)
    let line: number
    let column: number
    if (offset != null) {
      ;({ line, column } = offsetToLineCol(content, offset))
    } else {
      const lc = jsonErrorLineCol(message)
      if (lc) {
        ;({ line, column } = lc)
      } else {
        line = 1
        column = 1
      }
    }
    // Offer the autofix as a quick-fix when one exists (whole-file replace).
    const fixed = autofixJson(content)
    const fixes =
      fixed != null
        ? [{ title: 'Fix / format JSON', edit: { newText: fixed } } satisfies NonNullable<Diagnostic['fixes']>[number]]
        : undefined
    return [makeDiagnostic(line, column, `Invalid JSON: ${message}`, JSON_SOURCE, fixes)]
  }
}

/** Validate YAML content via `parseDocument`; collect errors + warnings. */
function validateYaml(content: string): Diagnostic[] {
  if (content.trim() === '') return []
  let doc: ReturnType<typeof parseDocument>
  try {
    doc = parseDocument(content, { prettyErrors: true })
  } catch (err) {
    // parseDocument collects rather than throws, but guard anyway.
    const message = err instanceof Error ? err.message : String(err)
    return [makeDiagnostic(1, 1, `Invalid YAML: ${message}`, YAML_SOURCE)]
  }

  const out: Diagnostic[] = []
  for (const e of doc.errors) {
    const at = e.linePos?.[0]
    const line = at?.line ?? offsetToLineCol(content, e.pos[0]).line
    const column = at?.col ?? offsetToLineCol(content, e.pos[0]).column
    out.push(makeDiagnostic(line, column, `Invalid YAML: ${e.message}`, YAML_SOURCE))
  }
  for (const w of doc.warnings) {
    const at = w.linePos?.[0]
    const line = at?.line ?? offsetToLineCol(content, w.pos[0]).line
    const column = at?.col ?? offsetToLineCol(content, w.pos[0]).column
    out.push({
      line: Math.max(1, line),
      column: Math.max(1, column),
      severity: 'warning',
      message: `YAML warning: ${w.message}`,
      source: YAML_SOURCE
    })
  }

  // When there are errors, also attach the format autofix to the FIRST one so
  // it surfaces as a lightbulb (only added when a safe fix is actually found).
  if (out.length > 0 && out[0].severity === 'error') {
    const fixed = autofixYaml(content)
    if (fixed != null) {
      out[0] = { ...out[0], fixes: [{ title: 'Format YAML', edit: { newText: fixed } }] }
    }
  }
  return out
}

/**
 * Validate a file's content by extension. Returns `[]` for valid content and
 * for unsupported extensions (callers treat an empty list as "nothing to do").
 */
export function validateFormat(name: string, content: string): Diagnostic[] {
  const kind = formatKindForName(name)
  if (kind === 'json') return validateJson(content)
  if (kind === 'yaml') return validateYaml(content)
  return []
}

/**
 * Produce an autofixed/canonical JSON string, or `null` when none is safe.
 *
 *  - If the content already parses, return it pretty-printed (2-space indent).
 *  - Otherwise try a best-effort cleanup ({@link stripJsonNoise}); if the
 *    cleaned text parses, return it pretty-printed.
 *  - Returns `null` when neither parses, or when the canonical form equals the
 *    input (nothing to do).
 */
export function autofixJson(content: string): string | null {
  const format = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`
  try {
    const parsed: unknown = JSON.parse(content)
    const out = format(parsed)
    return out === content ? null : out
  } catch {
    // fall through to best-effort cleanup
  }
  try {
    const parsed: unknown = JSON.parse(stripJsonNoise(content))
    return format(parsed)
  } catch {
    return null
  }
}

/**
 * Produce a canonical YAML string, or `null` when none is safe. Only offered
 * when the content parses cleanly (no errors) and the re-stringified form
 * differs from the input; an unparseable document has no safe automatic fix.
 */
export function autofixYaml(content: string): string | null {
  try {
    const doc = parseDocument(content)
    if (doc.errors.length > 0) return null
    const out = doc.toString()
    return out === content ? null : out
  } catch {
    return null
  }
}

/**
 * Return an autofixed string for a file by extension, or `null` when no safe
 * fix exists / the extension is unsupported.
 */
export function autofixFormat(name: string, content: string): string | null {
  const kind = formatKindForName(name)
  if (kind === 'json') return autofixJson(content)
  if (kind === 'yaml') return autofixYaml(content)
  return null
}
