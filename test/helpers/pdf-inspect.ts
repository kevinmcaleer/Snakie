/**
 * A minimal PDF READER, for testing the writer (#1113).
 *
 * The writer's promises are structural — "every xref entry is a byte offset
 * that lands on the object it claims", "`/Count` matches the pages", "`/Length`
 * is the encoded byte length" — and none of those can be checked by looking at
 * the source string. So the tests parse the produced bytes back, deliberately
 * re-implementing the format independently rather than importing the writer's
 * own helpers: a shared bug would otherwise agree with itself.
 */

/** Byte-for-byte string view of the file, so index maths is byte maths. */
export function latin1(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 8192) {
    out += String.fromCharCode(...bytes.subarray(i, i + 8192))
  }
  return out
}

/** Windows-1252's `0x80`–`0x9F` block, for decoding text back out. */
const HIGH = '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ'

/** Decode WinAnsi bytes (as a latin1 string) back to a JS string. */
export function decodeWinAnsi(raw: string): string {
  let out = ''
  for (const ch of raw) {
    const c = ch.charCodeAt(0)
    out += c >= 0x80 && c <= 0x9f ? HIGH[c - 0x80] : ch
  }
  return out
}

/** One indirect object as the cross-reference table describes it. */
export interface PdfObject {
  id: number
  offset: number
  /** Everything between `N 0 obj` and `endobj`. */
  body: string
  /** The raw stream bytes, when the object has one. */
  stream?: string
}

export interface ParsedPdf {
  bytes: Uint8Array
  raw: string
  objects: Map<number, PdfObject>
  /** `/Size` from the trailer. */
  size: number
  trailer: string
  startxref: number
}

/**
 * Parse a PDF by following its cross-reference table, THROWING on any entry
 * whose offset does not land exactly on the `N 0 obj` it claims. Parsing is the
 * assertion: a file this function reads is a file whose xref is sound.
 */
export function parsePdf(bytes: Uint8Array): ParsedPdf {
  const raw = latin1(bytes)
  if (!raw.startsWith('%PDF-')) throw new Error('missing %PDF header')

  const marker = raw.lastIndexOf('startxref')
  if (marker < 0) throw new Error('missing startxref')
  const startxref = Number(/startxref\s+(\d+)/.exec(raw.slice(marker))?.[1])
  if (!Number.isFinite(startxref)) throw new Error('unreadable startxref')

  const xref = raw.slice(startxref)
  const head = /^xref\s+(\d+)\s+(\d+)\s/.exec(xref)
  if (!head) throw new Error(`no xref table at byte ${startxref}`)
  const first = Number(head[1])
  const count = Number(head[2])
  let cursor = startxref + head[0].length

  const objects = new Map<number, PdfObject>()
  for (let i = 0; i < count; i++) {
    const entry = raw.slice(cursor, cursor + 20)
    cursor += 20
    const m = /^(\d{10}) (\d{5}) ([nf])/.exec(entry)
    if (!m) throw new Error(`malformed xref entry ${i}: ${JSON.stringify(entry)}`)
    if (m[3] === 'f') continue
    const id = first + i
    const offset = Number(m[1])
    const expect = `${id} 0 obj`
    const at = raw.slice(offset, offset + expect.length)
    if (at !== expect) {
      throw new Error(
        `xref says object ${id} is at byte ${offset}, but that byte reads ${JSON.stringify(
          raw.slice(offset, offset + 24)
        )}`
      )
    }
    const end = raw.indexOf('endobj', offset)
    if (end < 0) throw new Error(`object ${id} has no endobj`)
    const body = raw.slice(offset + expect.length, end)
    objects.set(id, { id, offset, body, stream: readStream(body) })
  }

  const trailerAt = raw.indexOf('trailer', startxref)
  const trailer = trailerAt < 0 ? '' : raw.slice(trailerAt, raw.indexOf('%%EOF', trailerAt))
  const size = Number(/\/Size\s+(\d+)/.exec(trailer)?.[1] ?? 0)
  return { bytes, raw, objects, size, trailer, startxref }
}

/**
 * The bytes of an object's stream, verified against its own `/Length`. Returns
 * undefined when the object has no stream; throws when `/Length` lies, which is
 * the corruption that opens in one reader and not another.
 */
function readStream(body: string): string | undefined {
  const at = body.indexOf('stream\n')
  if (at < 0) return undefined
  const declared = Number(/\/Length\s+(\d+)/.exec(body)?.[1])
  if (!Number.isFinite(declared)) throw new Error('stream object without /Length')
  const start = at + 'stream\n'.length
  const data = body.slice(start, start + declared)
  const after = body.slice(start + declared)
  if (!after.startsWith('\nendstream')) {
    throw new Error(
      `/Length ${declared} does not reach endstream — the stream is ${
        body.indexOf('\nendstream', start) - start
      } bytes`
    )
  }
  return data
}

/** The object the trailer's `/Root` points at. */
export function catalog(pdf: ParsedPdf): PdfObject {
  const id = Number(/\/Root\s+(\d+) 0 R/.exec(pdf.trailer)?.[1])
  const obj = pdf.objects.get(id)
  if (!obj) throw new Error('trailer /Root does not resolve')
  return obj
}

/** Every `/Type /Page` object, in `/Kids` order. */
export function pages(pdf: ParsedPdf): PdfObject[] {
  const pagesId = Number(/\/Pages\s+(\d+) 0 R/.exec(catalog(pdf).body)?.[1])
  const tree = pdf.objects.get(pagesId)
  if (!tree) throw new Error('catalog /Pages does not resolve')
  const kids = /\/Kids\s*\[([^\]]*)\]/.exec(tree.body)?.[1] ?? ''
  const ids = [...kids.matchAll(/(\d+) 0 R/g)].map((m) => Number(m[1]))
  const declared = Number(/\/Count\s+(\d+)/.exec(tree.body)?.[1])
  if (declared !== ids.length) {
    throw new Error(`/Pages says /Count ${declared} but lists ${ids.length} kids`)
  }
  return ids.map((id) => {
    const obj = pdf.objects.get(id)
    if (!obj) throw new Error(`/Kids references missing object ${id}`)
    return obj
  })
}

/** A page's decoded content stream. */
export function pageContent(pdf: ParsedPdf, page: PdfObject): string {
  const id = Number(/\/Contents\s+(\d+) 0 R/.exec(page.body)?.[1])
  const obj = pdf.objects.get(id)
  // An empty stream is legal (a page with nothing drawn on it), so this asks
  // whether the object HAS a stream, not whether it has bytes.
  if (obj?.stream === undefined) throw new Error(`page ${page.id} has no content stream`)
  return obj.stream
}

/** Undo the writer's literal-string escaping. */
function unescape(s: string): string {
  return s.replace(/\\([\\()rnt])/g, (_, c: string) =>
    c === 'r' ? '\r' : c === 'n' ? '\n' : c === 't' ? '\t' : c
  )
}

/** Every string shown with `Tj` on a page, in order, decoded from WinAnsi. */
export function pageStrings(pdf: ParsedPdf, page: PdfObject): string[] {
  const content = pageContent(pdf, page)
  const out: string[] = []
  // Literal strings may contain escaped parens, so scan rather than regex.
  for (let i = 0; i < content.length; i++) {
    if (content[i] !== '(') continue
    let depth = 1
    let j = i + 1
    let buf = ''
    while (j < content.length && depth > 0) {
      const c = content[j]
      if (c === '\\') {
        buf += c + (content[j + 1] ?? '')
        j += 2
        continue
      }
      if (c === '(') depth++
      else if (c === ')') {
        depth--
        if (!depth) break
      }
      buf += c
      j++
    }
    if (
      content
        .slice(j + 1, j + 8)
        .trimStart()
        .startsWith('Tj')
    ) {
      out.push(decodeWinAnsi(unescape(buf)))
    }
    i = j
  }
  return out
}

/** One `BT … ET` run: the text shown, and the font and size it was set in. */
export interface TextRun {
  /** The font RESOURCE name — `F1` Helvetica, `F2` Helvetica-Bold, `F3` Courier. */
  font: string
  size: number
  text: string
}

/**
 * Every text run on a page, with the size it was set at.
 *
 * `pageStrings` answers what a page SAYS; this answers how it says it, which is
 * what a claim like "a function name is lettered like the section heading"
 * (#1147) actually rests on. Runs are split on the writer's own `BT`/`ET`
 * lines, so a literal string containing those letters cannot be mistaken for
 * one.
 */
export function pageRuns(pdf: ParsedPdf, page: PdfObject): TextRun[] {
  const out: TextRun[] = []
  // The leading newline lets a `BT` that opens the stream split like the rest.
  for (const block of `\n${pageContent(pdf, page)}`.split('\nBT\n').slice(1)) {
    const body = block.split('\nET')[0]
    const set = /\/(F\d+) ([\d.]+) Tf/.exec(body)
    const shown = /\(([\s\S]*)\) Tj/.exec(body)
    if (!set || !shown) continue
    out.push({ font: set[1], size: Number(set[2]), text: decodeWinAnsi(unescape(shown[1])) })
  }
  return out
}

/** All text shown on a page, joined by newlines. */
export function pageText(pdf: ParsedPdf, page: PdfObject): string {
  return pageStrings(pdf, page).join('\n')
}

/** Every `/URI` link annotation target on a page. */
export function pageLinks(pdf: ParsedPdf, page: PdfObject): string[] {
  const annots = /\/Annots\s*\[([^\]]*)\]/.exec(page.body)?.[1] ?? ''
  return [...annots.matchAll(/(\d+) 0 R/g)].map((m) => {
    const obj = pdf.objects.get(Number(m[1]))
    if (!obj) throw new Error(`/Annots references missing object ${m[1]}`)
    const uri = /\/URI\s*\(((?:[^\\()]|\\.)*)\)/.exec(obj.body)?.[1]
    if (uri === undefined) throw new Error(`annotation ${m[1]} has no /URI`)
    return decodeWinAnsi(unescape(uri))
  })
}

/** The `/XObject` image resources a page declares, as resource name → object. */
export function pageImages(pdf: ParsedPdf, page: PdfObject): Map<string, PdfObject> {
  const dict = /\/XObject\s*<<([^>]*)>>/.exec(page.body)?.[1] ?? ''
  const out = new Map<string, PdfObject>()
  for (const m of dict.matchAll(/\/(\w+)\s+(\d+) 0 R/g)) {
    const obj = pdf.objects.get(Number(m[2]))
    if (!obj) throw new Error(`/XObject ${m[1]} references missing object ${m[2]}`)
    out.set(m[1], obj)
  }
  return out
}
