/**
 * HELP LIBRARY content model — a TechNet-style document tree.
 *
 * Static contents (Getting Started · Reference · Instruments) plus a runtime
 * "In This Project" section built by {@link detectProjectParts} from the active
 * file's hardware usage. Article bodies live in {@link ./help-articles}.
 *
 * ## Dialect (#763, epic #209)
 *
 * Pages carry a {@link DialectScope}, and {@link helpTreeFor} prunes the tree to
 * the runtime in use — so a CircuitPython session is never offered "Pins & GPIO"
 * teaching `machine.Pin`, and a MicroPython one isn't shown `digitalio`. Pages
 * with no scope are plain Python (control flow, types, the panels themselves)
 * and appear on both.
 *
 * An UNESTABLISHED dialect shows everything, because somebody reading before
 * they plug a board in should not be shown one runtime's answer as if it were
 * the only one — see `inScope` in `shared/dialect-api.ts`.
 *
 * To add a page: drop `./help/<id>.md`, add a node here with the right `scope`.
 */
import { INSTRUMENTS } from './instruments-registry'
import { inScope, type DialectScope } from '../../../shared/dialect-api'
import type { Dialect } from '../../../shared/dialect'
import type { PartDefinition, PartLibraryWithParts } from '../../../preload/index.d'

export type HelpKind = 'shelf' | 'collection' | 'section' | 'article'

export interface HelpNode {
  id: string
  kind: HelpKind
  title: string
  /** Mono descriptor shown after the title (e.g. a part's import name). */
  meta?: string
  /** Icon accent colour (defaults per kind). */
  accent?: string
  children?: HelpNode[]
  /** "In This Project" rows: a live/connected dot. */
  live?: boolean
  /** Runtime: the part whose declaration the caret is on. */
  atCursor?: boolean
  /** Which runtimes this page is true for. Absent = plain Python, so both. */
  scope?: DialectScope
}

/** Icon accents for the evergreen sections (from the design tokens). */
const A = {
  gettingStarted: '#37884a',
  reference: '#b58a2e',
  language: '#3f74ad',
  micropython: '#3f74ad',
  // Purple sets the CircuitPython book apart at a glance from the blue
  // MicroPython one, which matters most when both are on screen (`unknown`).
  circuitpython: '#7a4fa8',
  pinouts: '#c07a2a',
  instruments: '#2f7c70',
  page: '#8a7f62',
  project: '#2f7c70'
}

/** The evergreen contents (everything except the runtime "In This Project"). */
export const HELP_SECTIONS: HelpNode[] = [
  {
    id: 'getting-started',
    kind: 'section',
    title: 'Getting Started',
    accent: A.gettingStarted,
    children: [
      { id: 'gs-connect', kind: 'article', title: 'Connect your board', accent: '#3f74ad' },
      // "Write & run code" means something different on each runtime: MicroPython
      // runs what Snakie sends, CircuitPython boots code.py and re-runs it on
      // every save. Two pages rather than one hedged page.
      {
        id: 'gs-run',
        kind: 'article',
        title: 'Write & run code',
        accent: '#37a04f',
        scope: 'micropython'
      },
      {
        id: 'cp-code-py',
        kind: 'article',
        title: 'Write & run code (code.py)',
        accent: '#37a04f',
        scope: 'circuitpython'
      },
      {
        id: 'cp-readonly',
        kind: 'article',
        title: 'The read-only filesystem',
        accent: '#c2483a',
        scope: 'circuitpython'
      },
      { id: 'gs-instruments', kind: 'article', title: 'Using instruments', accent: '#8b5fc0' },
      { id: 'gs-board-view', kind: 'article', title: 'The Board View', accent: '#2f7c70' },
      { id: 'gs-files', kind: 'article', title: 'Files & sync', accent: '#c07a2a' },
      {
        id: 'gs-firmware',
        kind: 'article',
        title: 'Flash MicroPython firmware',
        accent: '#c2483a',
        scope: 'micropython'
      },
      {
        id: 'cp-firmware',
        kind: 'article',
        title: 'Flash CircuitPython firmware',
        accent: '#c2483a',
        scope: 'circuitpython'
      },
      {
        id: 'gs-packages',
        kind: 'article',
        title: 'Install packages (mip)',
        accent: '#3f74ad',
        scope: 'micropython'
      },
      {
        id: 'cp-libraries',
        kind: 'article',
        title: 'Install libraries (the bundle)',
        accent: '#3f74ad',
        scope: 'circuitpython'
      },
      { id: 'gs-validation', kind: 'article', title: 'Problems & validation', accent: '#b58a2e' },
      { id: 'gs-git', kind: 'article', title: 'Version control (Git)', accent: '#37884a' },
      { id: 'gs-chat', kind: 'article', title: 'AI chat & autocomplete', accent: '#8b5fc0' },
      { id: 'gs-updater', kind: 'article', title: 'Keeping Snakie up to date', accent: '#8a7f62' }
    ]
  },
  {
    id: 'instruments',
    kind: 'section',
    title: 'Instruments',
    accent: A.instruments,
    // One article per registered instrument; the "?" button on each instrument
    // opens `inst-<id>`. The page icon takes the instrument's accent.
    children: INSTRUMENTS.map((d) => ({
      id: `inst-${d.id}`,
      kind: 'article' as const,
      title: d.name,
      accent: d.accent
    }))
  },
  {
    id: 'reference',
    kind: 'collection',
    title: 'Reference',
    accent: A.reference,
    children: [
      // Plain Python — identical on both runtimes, so it is NOT duplicated per
      // dialect. Keep it that way: anything that would need a different example
      // on CircuitPython belongs in one of the two hardware sections below.
      {
        id: 'ref-python',
        kind: 'section',
        title: 'Python Language',
        accent: A.language,
        children: [
          { id: 'ref-print', kind: 'article', title: 'print & the REPL', accent: A.page },
          { id: 'ref-flow', kind: 'article', title: 'Control flow', accent: A.page },
          { id: 'ref-functions', kind: 'article', title: 'Functions', accent: A.page },
          { id: 'ref-types', kind: 'article', title: 'Values & types', accent: A.page },
          { id: 'ref-builtins', kind: 'article', title: 'Built-in functions', accent: A.page },
          { id: 'ref-classes', kind: 'article', title: 'Classes', accent: A.page },
          { id: 'ref-exceptions', kind: 'article', title: 'Errors & exceptions', accent: A.page },
          { id: 'ref-imports', kind: 'article', title: 'Imports & modules', accent: A.page }
        ]
      },
      {
        id: 'ref-micropython',
        kind: 'section',
        title: 'MicroPython Hardware',
        accent: A.micropython,
        scope: 'micropython',
        children: [
          { id: 'ref-pins', kind: 'article', title: 'Pins & GPIO', accent: A.page },
          { id: 'ref-timing', kind: 'article', title: 'Timing', accent: A.page },
          { id: 'ref-i2c', kind: 'article', title: 'I²C', accent: A.page },
          { id: 'ref-spi', kind: 'article', title: 'SPI', accent: A.page },
          { id: 'ref-uart', kind: 'article', title: 'UART', accent: A.page },
          { id: 'ref-pwm', kind: 'article', title: 'PWM', accent: A.page }
        ]
      },
      {
        id: 'ref-circuitpython',
        kind: 'section',
        title: 'CircuitPython Hardware',
        accent: A.circuitpython,
        scope: 'circuitpython',
        children: [
          { id: 'cp-board', kind: 'article', title: 'board — this board’s pins', accent: A.page },
          { id: 'cp-digitalio', kind: 'article', title: 'Pins & GPIO (digitalio)', accent: A.page },
          { id: 'cp-analogio', kind: 'article', title: 'Analogue (analogio)', accent: A.page },
          { id: 'cp-pwmio', kind: 'article', title: 'PWM (pwmio)', accent: A.page },
          { id: 'cp-busio', kind: 'article', title: 'I²C, SPI & UART (busio)', accent: A.page },
          { id: 'cp-timing', kind: 'article', title: 'Timing', accent: A.page },
          {
            id: 'cp-from-micropython',
            kind: 'article',
            title: 'Coming from MicroPython',
            accent: A.page
          }
        ]
      },
      {
        id: 'ref-pinouts',
        kind: 'section',
        title: 'Pinouts',
        accent: A.pinouts,
        children: [{ id: 'ref-pinout', kind: 'article', title: 'Board pinouts', accent: A.page }]
      }
    ]
  }
]

/** Node ids that start EXPANDED (the rest collapse). */
export const DEFAULT_EXPANDED = new Set([
  'in-this-project',
  'getting-started',
  'instruments',
  'reference',
  'ref-python',
  'ref-micropython',
  'ref-circuitpython'
])

/**
 * The contents as one runtime sees them.
 *
 * Prunes every node whose {@link HelpNode.scope} excludes `dialect`, depth
 * first, and drops a branch that ends up empty — so a MicroPython session never
 * sees an empty "CircuitPython Hardware" book. `unknown` keeps everything (see
 * the module note): with no board attached, showing one runtime's pages as if
 * they were the only ones is the mistake, not showing both.
 */
export function helpTreeFor(dialect: Dialect, nodes: HelpNode[] = HELP_SECTIONS): HelpNode[] {
  const out: HelpNode[] = []
  for (const node of nodes) {
    if (!inScope(node.scope, dialect)) continue
    if (!node.children) {
      out.push(node)
      continue
    }
    const children = helpTreeFor(dialect, node.children)
    // A branch that has lost all its pages has nothing left to open.
    if (children.length === 0) continue
    out.push({ ...node, children })
  }
  return out
}

/**
 * Articles that are reachable on every dialect but whose EXAMPLES are
 * MicroPython — the instrument pages, because Snakie's on-device instrument
 * library is built on `machine` and has not been ported yet (#760).
 *
 * Rather than hide the panels' documentation from a CircuitPython user, or
 * quietly show them `machine.Pin` as if it would run, the article view prints
 * {@link dialectNote} above the body. The unit test keeps this list honest: any
 * CircuitPython-visible page containing MicroPython-only code must be in it.
 */
export const MICROPYTHON_EXAMPLE_ARTICLES = new Set(
  INSTRUMENTS.map((d) => `inst-${d.id}`)
)

/**
 * The warning to print above an article whose code won't run on this dialect,
 * or `null` when there is nothing to say. Pure, so the wording is pinned by a
 * test rather than buried in JSX.
 */
export function dialectNote(articleId: string, dialect: Dialect): string | null {
  if (dialect !== 'circuitpython') return null
  if (!MICROPYTHON_EXAMPLE_ARTICLES.has(articleId)) return null
  return "The examples on this page are MicroPython — Snakie's on-device instrument library uses `machine`, which CircuitPython doesn't have. The panel itself works the same way; the code to drive it doesn't run on this board yet."
}

/** A part surfaced in "In This Project". */
export interface ProjectPart {
  /** The library part it maps to (for its bundled help). */
  part: PartDefinition
  articleId: string
  name: string
  meta: string
  accent: string
  live: boolean
  /** True when the caret is on the line that uses it. */
  atCursor: boolean
}

/** Tokens that identify a part in code — its import module + id, lower-cased. */
function partTokens(p: PartDefinition): string[] {
  const toks = [p.id, p.library?.module].filter(Boolean).map((s) => String(s).toLowerCase())
  return [...new Set(toks)]
}

/**
 * Detect the hardware parts the active file uses, for the "In This Project"
 * section. Matches a part when the source imports its module/id (e.g.
 * `from servo import Servo`, `import vl53l0x`) — the same signal the Board View
 * uses. `cursorLine` (the caret's 1-based line text) drives the "at cursor" badge.
 */
export function detectProjectParts(
  source: string,
  libraries: PartLibraryWithParts[],
  cursorLine?: string,
  /** Parts PLACED on the board (robot.yml `{lib, part}` pairs) — included even
   *  with no matching import, so the embedded Board mode's part help resolves
   *  here (modes review: one help surface). Rendered as non-live entries. */
  placed?: { lib: string; part: string }[]
): ProjectPart[] {
  const lower = (source ?? '').toLowerCase()
  const curLower = (cursorLine ?? '').toLowerCase()
  const out: ProjectPart[] = []
  const seen = new Set<string>()
  if (source) {
    for (const lib of libraries) {
      for (const part of lib.parts) {
        const toks = partTokens(part)
        if (toks.length === 0) continue
        // Match an `import <tok>` / `from <tok> import` usage anywhere in the file.
        const used = toks.some((t) => new RegExp(`\\b(?:import|from)\\s+${t}\\b`).test(lower))
        if (!used || seen.has(part.id)) continue
        seen.add(part.id)
        out.push({
          part,
          articleId: `part-${part.id}`,
          name: part.name,
          meta: part.library?.module ?? part.id,
          accent: part.pcbColor || A.project,
          live: true,
          atCursor: toks.some((t) => curLower.includes(t))
        })
      }
    }
  }
  // Board-placed parts join the section too (deduped against import matches).
  for (const rp of placed ?? []) {
    if (seen.has(rp.part)) continue
    const part = libraries.find((l) => l.id === rp.lib)?.parts.find((p) => p.id === rp.part)
    if (!part) continue
    seen.add(part.id)
    out.push({
      part,
      articleId: `part-${part.id}`,
      name: part.name,
      meta: 'on the board',
      accent: part.pcbColor || A.project,
      live: false,
      atCursor: false
    })
  }
  return out
}
