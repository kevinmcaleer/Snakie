/**
 * Go to Definition for the user's own Python (variables, functions, classes,
 * imports, loop variables, `self.x` attributes).
 *
 * One definition provider gives Monaco everything it needs for the standard
 * gestures — right-click "Go to Definition" / "Peek Definition", F12, and
 * Cmd/Ctrl+click (with the underline on hover while the key is held). A hover
 * provider adds "defined on line 34" with the line's code and a link that
 * jumps there, so the definition is discoverable without knowing the gestures.
 *
 * Unlike the stub-driven completions this is dialect-independent: it only
 * reads the file in the editor.
 */
import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api'
import { codeOnly, definitionOf, findDefinitions, type Definition } from './python-definitions'
import { findUsages, functionHints, functionInfo, type FunctionInfo } from './python-function-info'
import { contextForModel } from './refactor-code-actions'
import { detectAll } from '../../../shared/refactor/engine'
import { ALL_RULES } from '../../../shared/refactor/rules'

const REGISTERED_KEY = '__snakiePythonNavigationRegistered'
type GuardedGlobal = typeof globalThis & { [REGISTERED_KEY]?: boolean }

/** The command a hover link runs: `snakie.goToLine(uri, line, column)`. */
export const GO_TO_LINE_COMMAND = 'snakie.goToLine'

/** Definitions per model version: hover and go-to both ask on the same gesture. */
let cache: { uri: string; version: number; defs: Definition[] } | null = null
function definitionsFor(model: Monaco.editor.ITextModel): Definition[] {
  const uri = model.uri.toString()
  const version = model.getVersionId()
  if (cache && cache.uri === uri && cache.version === version) return cache.defs
  const defs = findDefinitions(model.getValue())
  cache = { uri, version, defs }
  return defs
}

/**
 * The definition of the identifier under the cursor, or null. Member access on
 * anything but `self` (`machine.Pin`, `led.on`) is not the file's own name, so
 * it is left to the stub hover; so is a word inside a string or comment.
 */
export function lookup(
  model: Monaco.editor.ITextModel,
  position: Monaco.Position
): { def: Definition; word: Monaco.editor.IWordAtPosition } | null {
  const word = model.getWordAtPosition(position)
  if (!word || !/^[A-Za-z_]/.test(word.word)) return null
  const line = model.getLineContent(position.lineNumber)
  const code = codeOnly(line)
  if (code[word.startColumn - 1] !== line[word.startColumn - 1]) return null
  const before = line.slice(0, word.startColumn - 1)
  const attribute = /\bself\.\s*$/.test(before)
  if (!attribute && /\.\s*$/.test(before)) return null
  const defs = definitionsFor(model)
  let def = definitionOf(model.getValue(), word.word, position.lineNumber, attribute, defs)
  // `self.drive()` / `bot.drive()` names a method, which is a `def` inside a
  // class rather than a `self.x = …` attribute.
  if (!def && attribute) def = defs.find((d) => d.kind === 'function' && d.cls !== null && d.name === word.word) ?? null
  return def ? { def, word } : null
}

/** How many usages the hover lists before "and N more". */
const MAX_USAGES = 8

/** Escape text so Markdown shows it literally (docstrings, code lines in link labels). */
function escapeMd(s: string): string {
  return s.replace(/[\\`*_{}[\]()#+!|<>~]/g, (c) => `\\${c}`)
}

/** Refactoring-catalogue hints whose match starts inside the function, per model version. */
let catalogueCache: { uri: string; version: number; hits: { line: number; text: string }[] } | null = null
function catalogueHints(model: Monaco.editor.ITextModel, info: FunctionInfo): string[] {
  const uri = model.uri.toString()
  const version = model.getVersionId()
  if (!catalogueCache || catalogueCache.uri !== uri || catalogueCache.version !== version) {
    const ctx = contextForModel(model)
    const hits = ctx
      ? detectAll(ctx, ALL_RULES).map((o) => ({
          line: ctx.lines.rangeOf(o.match).startLine,
          text: `${o.match.title ?? o.rule.title}: ${o.match.message ?? o.rule.message}`
        }))
      : []
    catalogueCache = { uri, version, hits }
  }
  const seen = new Set<string>()
  return catalogueCache.hits
    .filter((h) => h.line >= info.bodyStart && h.line <= info.bodyEnd)
    .filter((h) => !seen.has(h.text) && !!seen.add(h.text))
    .map((h) => `${h.text} (line ${h.line})`)
}

function goToLink(model: Monaco.editor.ITextModel, label: string, line: number, column: number): string {
  const args = encodeURIComponent(JSON.stringify([model.uri.toString(), line, column]))
  return `[${label}](command:${GO_TO_LINE_COMMAND}?${args})`
}

/**
 * The hover for one of the file's own functions: signature, kind, docstring,
 * parameters, every usage (each a link that jumps there) and hints. Each part
 * is its own hover section, so Monaco draws a rule between them.
 */
export function functionHoverSections(
  model: Monaco.editor.ITextModel,
  info: FunctionInfo,
  onDefinition: boolean
): string[] {
  const text = model.getValue()
  const usages = findUsages(text, info)
  const kind = info.className ? `method of \`${info.className}\`` : info.isAsync ? 'async function' : 'function'
  const where = onDefinition
    ? `defined here, line ${info.line}`
    : `defined on ${goToLink(model, `line ${info.line}`, info.line, info.column)}`
  const sections: string[] = []

  sections.push(
    [
      `**\`${info.name}\`** · ${kind} · ${where}`,
      '```python',
      ...info.decorators,
      info.signature,
      '```'
    ].join('\n')
  )

  if (info.docstring) sections.push(info.docstring.split('\n').map(escapeMd).join('  \n'))

  if (info.params.length) {
    const rows = info.params.map((p) => {
      const star = p.kind === 'star' ? '*' : p.kind === 'starstar' ? '**' : ''
      const type = p.annotation ? ` · \`${p.annotation}\`` : ''
      const dflt = p.default !== null ? ` · default \`${p.default}\`` : ' · required'
      return `- \`${star}${p.name}\`${type}${p.kind === 'normal' ? dflt : ''}`
    })
    const ret = info.returns ? `\n\nReturns \`${info.returns}\`` : ''
    sections.push(`**Parameters**\n\n${rows.join('\n')}${ret}`)
  } else {
    sections.push(`No parameters${info.returns ? ` · returns \`${info.returns}\`` : ''}`)
  }

  if (usages.length) {
    const shown = usages.slice(0, MAX_USAGES).map((u) => {
      const code = u.text.length > 60 ? `${u.text.slice(0, 57)}…` : u.text
      return `- ${goToLink(model, `Line ${u.line}`, u.line, u.column)} · \`${code.replace(/`/g, "'")}\``
    })
    const more = usages.length > MAX_USAGES ? `\n- …and ${usages.length - MAX_USAGES} more` : ''
    const times = usages.length === 1 ? 'once' : `${usages.length} times`
    sections.push(`**Used ${times}**\n\n${shown.join('\n')}${more}`)
  } else {
    sections.push('**Not used in this file**')
  }

  const hints = [...functionHints(text, info, usages), ...catalogueHints(model, info)]
  if (hints.length) sections.push(`**Hints**\n\n${hints.map((h) => `- ${h}`).join('\n')}`)
  return sections
}

const KIND_LABEL: Record<Definition['kind'], string> = {
  variable: 'variable',
  function: 'function',
  class: 'class',
  parameter: 'parameter',
  import: 'import',
  loop: 'loop variable',
  attribute: 'attribute'
}

/** Register the definition + hover providers and the jump command. Idempotent. */
export function registerPythonNavigation(monaco: typeof Monaco): Monaco.IDisposable | undefined {
  const g = globalThis as GuardedGlobal
  if (g[REGISTERED_KEY]) return undefined
  g[REGISTERED_KEY] = true

  const command = monaco.editor.registerCommand(
    GO_TO_LINE_COMMAND,
    (_accessor, uri: string, line: number, column: number) => {
      const editor = monaco.editor
        .getEditors()
        .find((e) => e.getModel()?.uri.toString() === uri)
      if (!editor) return
      editor.setPosition({ lineNumber: line, column })
      editor.revealLineInCenterIfOutsideViewport(line)
      editor.focus()
    }
  )

  const definitions = monaco.languages.registerDefinitionProvider('python', {
    provideDefinition(model, position) {
      const hit = lookup(model, position)
      if (!hit) return null
      const { def } = hit
      return {
        uri: model.uri,
        range: {
          startLineNumber: def.line,
          startColumn: def.column,
          endLineNumber: def.line,
          endColumn: def.column + def.name.length
        }
      }
    }
  })

  const hovers = monaco.languages.registerHoverProvider('python', {
    provideHover(model, position) {
      const hit = lookup(model, position)
      if (!hit) return null
      const { def, word } = hit
      const range = {
        startLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endLineNumber: position.lineNumber,
        endColumn: word.endColumn
      }
      const onDefinition = def.line === position.lineNumber && def.column === word.startColumn
      // One of the file's own functions: the full card, on its uses and on its `def`.
      const info = def.kind === 'function' ? functionInfo(model.getValue(), def.line) : null
      if (info) {
        const trusted = { enabledCommands: [GO_TO_LINE_COMMAND] }
        return {
          range,
          contents: functionHoverSections(model, info, onDefinition).map((value) => ({ value, isTrusted: trusted }))
        }
      }
      // Hovering the definition itself: nothing to point at.
      if (onDefinition) return null
      const args = encodeURIComponent(JSON.stringify([model.uri.toString(), def.line, def.column]))
      const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
      const value = [
        `**\`${def.name}\`** · ${KIND_LABEL[def.kind]} defined on line ${def.line}`,
        '```python',
        def.text,
        '```',
        `[Go to line ${def.line}](command:${GO_TO_LINE_COMMAND}?${args}) · or ${mac ? '⌘' : 'Ctrl'}+click the name`
      ].join('\n')
      return {
        range: {
          startLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endLineNumber: position.lineNumber,
          endColumn: word.endColumn
        },
        contents: [{ value, isTrusted: { enabledCommands: [GO_TO_LINE_COMMAND] } }]
      }
    }
  })

  const disposable = {
    dispose: () => {
      command.dispose()
      definitions.dispose()
      hovers.dispose()
    }
  }
  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      disposable.dispose()
      g[REGISTERED_KEY] = false
    })
  }
  return disposable
}
