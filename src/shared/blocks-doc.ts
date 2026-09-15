/**
 * THE BLOCKS DOCUMENT MODEL (#1008, epic #1007).
 * =============================================================================
 *
 * A blocks program **is a `.py` file**. There is no project format, no sidecar,
 * no database — the Blockly workspace is deflated, base64'd and parked in a
 * trailing comment footer under the MicroPython it generated:
 *
 * ```python
 * from snakie import Led
 * Led(15).on()
 *
 * # --8<-- snakie-blocks v1 (do not edit below this line)
 * # eJyrVspLzE1VslJQ8...
 * # ...
 * ```
 *
 * WHY ONE FILE. The alternative was a `.blocks.json` sidecar, and it loses on
 * every axis that matters in a classroom: a one-file program runs on the board
 * unmodified, survives being emailed, copied to a USB stick, pasted into a chat,
 * committed to git and downloaded again — and a sidecar is exactly the file a
 * ten-year-old drops. The cost is a footer the learner can see, which we lean
 * into: it says "do not edit below this line" and the app treats a hand-edit as
 * a conflict to ASK about, never to silently overwrite.
 *
 * WHAT'S IN HERE. Everything about the format and nothing about the UI: this
 * module is React-free, DOM-free and Electron-free, so main, the renderer, the
 * web build and a node unit test can all import it. The Blockly canvas (#1009)
 * and the MicroPython generator (#1010) land on top of this spine.
 *
 * THE TWO RULES EVERYTHING ELSE RELIES ON:
 *
 *  1. **Code and workspace are written together or not at all.**
 *     {@link writeBlocksFooter} takes both and returns the whole file, so no
 *     caller can save a `.py` whose blocks say something else. The workspace
 *     store's `updateBlocks` is the only writer of a blocks buffer for exactly
 *     this reason.
 *  2. **A footer we can't read is not an error, it's a plain `.py`.**
 *     Corrupt base64, truncated payload, a version from a newer Snakie, a
 *     `snakie-blocks` line someone typed by hand — every one of them makes
 *     {@link parseBlocksFooter} return `null`, never throw. The file then opens
 *     in Monaco with its text byte-for-byte intact, which is the one outcome
 *     that can't lose somebody's work.
 *
 * CONFLICT DETECTION. The footer also records a fingerprint of the code it was
 * written with ({@link hashBlocksCode}). If the two disagree when the file is
 * re-opened, somebody edited the Python by hand — {@link BlocksDoc.codeMatches}
 * goes false and the app asks which side wins (`blocksConflict` on the open
 * file). The fingerprint ignores line endings and trailing whitespace, so a
 * git checkout with different EOLs, or an editor that trims on save, is not
 * mistaken for a hand-edit.
 */
import { deflateSync, inflateSync, strToU8, strFromU8 } from 'fflate'

/**
 * The footer schema version this build writes and understands.
 *
 * Same forward-compatibility contract as the layout store's envelope
 * (`store/layout.ts`): a HIGHER version came from a newer Snakie whose workspace
 * shape we can't be trusted to interpret, so we decline to read it rather than
 * guess — the file opens as plain Python with the footer untouched, and saving
 * it preserves the footer byte-for-byte for the newer build to pick up again.
 */
export const BLOCKS_SCHEMA_VERSION = 1

/**
 * The cheap substring every footer marker contains. Exported so callers that
 * scan a lot of text (a file tree, a search) can reject a file with one
 * `indexOf` before paying for the regex.
 */
export const BLOCKS_FOOTER_TAG = 'snakie-blocks v'

/**
 * The marker line. `--8<--` is the scissors-cut-here convention, which reads as
 * "everything below is machine business" without needing to know what Snakie is.
 */
function markerLine(version: number): string {
  return `# --8<-- snakie-blocks v${version} (do not edit below this line)`
}

/** Matches a marker line anywhere in a file, capturing its schema version. */
const MARKER_RE = /^#[ \t]*--8<--[ \t]+snakie-blocks[ \t]+v(\d+)[^\n]*$/gm

/**
 * A Blockly workspace in its serialised (JSON) form.
 *
 * Deliberately opaque here: this module's job is to carry it intact, and typing
 * it against Blockly's own `State` would drag a UI dependency into a file that
 * main and the web build import. #1009 owns what's inside.
 */
export type BlocksWorkspace = Record<string, unknown>

/** A `.py` file that carries a blocks footer this build can read. */
export interface BlocksDoc {
  /**
   * The generated MicroPython, footer stripped — exactly what runs on the board.
   * Normalised to `\n` line endings with no trailing blank lines.
   */
  code: string
  /** The serialised Blockly workspace the code was generated from. */
  workspace: BlocksWorkspace
  /** The footer's schema version (always ≤ {@link BLOCKS_SCHEMA_VERSION}). */
  version: number
  /**
   * False when `code` no longer matches the fingerprint the footer recorded —
   * i.e. somebody hand-edited the Python. NOT an error: the caller offers the
   * choice (keep the code and drop the blocks, or regenerate from the blocks).
   */
  codeMatches: boolean
}

/**
 * Is there a blocks footer THIS BUILD understands?
 *
 * The cheap predicate: an `indexOf` and a regex over the marker line, no
 * base64 and no inflate. A newer schema version answers `false` on purpose —
 * a tab glyph promising a block canvas that then refuses to open would be worse
 * than no glyph at all.
 *
 * A `true` here means the footer is *addressed to us*, not that its payload is
 * intact; {@link parseBlocksFooter} is the authority on that.
 */
export function hasBlocksFooter(source: string): boolean {
  const found = locateFooter(source)
  return found !== null && found.version <= BLOCKS_SCHEMA_VERSION
}

/**
 * The footer's schema version, or null if there isn't one.
 *
 * Separate from {@link hasBlocksFooter} so a caller can tell "no blocks here"
 * apart from "blocks from a newer Snakie" and say so.
 */
export function blocksFooterVersion(source: string): number | null {
  return locateFooter(source)?.version ?? null
}

/**
 * Read a blocks `.py`, or null if this isn't one we can read.
 *
 * Null covers every failure — no footer, a newer schema version, bad base64, a
 * truncated or non-inflatable payload, JSON that isn't our envelope. Never
 * throws: the caller's fallback is always "treat it as a plain `.py`", and a
 * throw here would turn a mangled file into a broken app.
 */
export function parseBlocksFooter(source: string): BlocksDoc | null {
  const found = locateFooter(source)
  if (!found || found.version > BLOCKS_SCHEMA_VERSION) return null

  const payload = collectPayload(source, found.bodyStart)
  if (!payload) return null

  let envelope: unknown
  try {
    envelope = JSON.parse(strFromU8(inflateSync(base64Decode(payload))))
  } catch {
    return null
  }
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) return null

  const { ws, hash } = envelope as { ws?: unknown; hash?: unknown }
  if (!ws || typeof ws !== 'object' || Array.isArray(ws)) return null

  const code = normaliseCode(source.slice(0, found.start))
  return {
    code,
    workspace: ws as BlocksWorkspace,
    version: found.version,
    // A footer with no fingerprint (only reachable from a hand-built file)
    // can't be checked, so we don't claim a conflict we haven't proven.
    codeMatches: typeof hash === 'string' ? hash === hashBlocksCode(code) : true
  }
}

/**
 * Serialise `code` + `workspace` into the full text of a blocks `.py`.
 *
 * The ONE writer. Callers never assemble a blocks file themselves — that is
 * what keeps the Python and the blocks from drifting apart, which is the whole
 * point of embedding the workspace in the first place.
 */
export function writeBlocksFooter(code: string, workspace: BlocksWorkspace): string {
  const body = normaliseCode(code)
  const envelope = { v: BLOCKS_SCHEMA_VERSION, hash: hashBlocksCode(body), ws: workspace }
  const payload = base64Encode(deflateSync(strToU8(JSON.stringify(envelope)), { level: 9 }))

  const lines = [markerLine(BLOCKS_SCHEMA_VERSION)]
  for (let i = 0; i < payload.length; i += PAYLOAD_LINE_LEN) {
    lines.push(`# ${payload.slice(i, i + PAYLOAD_LINE_LEN)}`)
  }
  // The blank line is not decoration: it keeps the footer from looking like a
  // comment on the last statement, and it is what the learner's eye stops at.
  return `${body}\n\n${lines.join('\n')}\n`
}

/**
 * Drop the footer and keep the Python — the file becomes an ordinary `.py`.
 *
 * Two callers, one operation: resolving a hand-edit conflict in favour of the
 * code, and **Graduate to Python** (#1016), which is the same act performed on
 * purpose. A source with no footer comes back unchanged.
 */
export function stripBlocksFooter(source: string): string {
  const found = locateFooter(source)
  if (!found) return source
  return `${normaliseCode(source.slice(0, found.start))}\n`
}

/**
 * The code fingerprint stored in the footer: two FNV-1a streams over the
 * normalised UTF-8 bytes, 16 hex characters.
 *
 * Not a cryptographic hash and doesn't need to be — it answers "did a human
 * touch this?", where the adversary is a text editor, not an attacker. Two
 * differently-seeded streams rather than one because a 32-bit collision on a
 * file someone actually edited is rare but a 64-bit one is not going to happen.
 */
export function hashBlocksCode(code: string): string {
  const bytes = strToU8(normaliseCode(code))
  return hex32(fnv1a(bytes, 0x811c9dc5)) + hex32(fnv1a(bytes, 0x7f8e1a3b))
}

// ---------------------------------------------------------------------------
// internals
// ---------------------------------------------------------------------------

/** Base64 characters per footer comment line — keeps the block inside 80 cols. */
const PAYLOAD_LINE_LEN = 76

interface FooterLocation {
  version: number
  /** Index of the first character of the marker line. */
  start: number
  /** Index of the first character after the marker line. */
  bodyStart: number
}

/**
 * Find the marker line. The LAST one wins: a blocks program can legitimately
 * contain the marker text inside a string literal or a raw-Python block (#1018),
 * and the real footer is always at the end of the file.
 */
function locateFooter(source: string): FooterLocation | null {
  if (source.indexOf(BLOCKS_FOOTER_TAG) === -1) return null
  MARKER_RE.lastIndex = 0
  let last: RegExpExecArray | null = null
  for (let m = MARKER_RE.exec(source); m !== null; m = MARKER_RE.exec(source)) last = m
  if (!last) return null
  const version = Number(last[1])
  if (!Number.isInteger(version) || version < 1) return null
  const end = last.index + last[0].length
  return { version, start: last.index, bodyStart: source[end] === '\n' ? end + 1 : end }
}

/**
 * Join the `# `-prefixed payload lines that follow the marker into one base64
 * string. Stops at the first line that isn't a comment — a blank line or stray
 * code after the footer ends it rather than corrupting it silently.
 */
function collectPayload(source: string, bodyStart: number): string | null {
  let payload = ''
  for (const raw of source.slice(bodyStart).split('\n')) {
    const line = raw.trim()
    if (!line.startsWith('#')) break
    payload += line.slice(1).trim()
  }
  return payload.length > 0 ? payload : null
}

/**
 * The canonical form of the Python half: `\n` line endings, no trailing
 * whitespace on any line, no trailing blank lines.
 *
 * Both the fingerprint and the written file go through this, so a checkout with
 * CRLF endings or an editor that trims on save round-trips as the same document
 * instead of reporting a hand-edit that never happened.
 */
function normaliseCode(code: string): string {
  return code
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n+$/, '')
}

function fnv1a(bytes: Uint8Array, seed: number): number {
  let h = seed >>> 0
  for (let i = 0; i < bytes.length; i++) {
    h = Math.imul(h ^ bytes[i], 0x01000193) >>> 0
  }
  return h >>> 0
}

function hex32(n: number): string {
  return n.toString(16).padStart(8, '0')
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
/** Reverse table; -1 for anything that isn't a base64 digit. */
const B64_INV = ((): Int8Array => {
  const t = new Int8Array(128).fill(-1)
  for (let i = 0; i < B64.length; i++) t[B64.charCodeAt(i)] = i
  return t
})()

/**
 * Base64 by hand rather than `btoa`/`Buffer`.
 *
 * `btoa` needs a binary string, which means a `String.fromCharCode` spread that
 * blows the stack on a large workspace, and `Buffer` doesn't exist in the web
 * build. Thirty lines here keeps one implementation for all four hosts.
 */
function base64Encode(bytes: Uint8Array): string {
  let out = ''
  let i = 0
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2]
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63]
  }
  const rest = bytes.length - i
  if (rest === 1) {
    const n = bytes[i] << 16
    out += `${B64[(n >> 18) & 63]}${B64[(n >> 12) & 63]}==`
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8)
    out += `${B64[(n >> 18) & 63]}${B64[(n >> 12) & 63]}${B64[(n >> 6) & 63]}=`
  }
  return out
}

/** Throws on a non-base64 character — the caller already treats a throw here as
 *  "this is a plain `.py`". */
function base64Decode(text: string): Uint8Array {
  const clean = text.replace(/=+$/, '')
  const out = new Uint8Array((clean.length * 3) >> 2)
  let acc = 0
  let bits = 0
  let o = 0
  for (let i = 0; i < clean.length; i++) {
    const c = clean.charCodeAt(i)
    const v = c < 128 ? B64_INV[c] : -1
    if (v < 0) throw new Error('bad base64')
    acc = (acc << 6) | v
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out[o++] = (acc >> bits) & 0xff
    }
  }
  return out.subarray(0, o)
}
