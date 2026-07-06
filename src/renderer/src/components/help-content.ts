/**
 * HELP LIBRARY content model — a TechNet-style document tree.
 *
 * Static contents (Getting Started · Reference · Instruments) plus a runtime
 * "In This Project" section built by {@link detectProjectParts} from the active
 * file's hardware usage. Article bodies live in {@link ./help-articles}.
 */
import { INSTRUMENTS } from './instruments-registry'
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
}

/** Icon accents for the evergreen sections (from the design tokens). */
const A = {
  gettingStarted: '#37884a',
  reference: '#b58a2e',
  language: '#3f74ad',
  buses: '#8b5fc0',
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
      { id: 'gs-run', kind: 'article', title: 'Write & run code', accent: '#37a04f' },
      { id: 'gs-instruments', kind: 'article', title: 'Using instruments', accent: '#8b5fc0' },
      { id: 'gs-board-view', kind: 'article', title: 'The Board View', accent: '#2f7c70' },
      { id: 'gs-files', kind: 'article', title: 'Files & sync', accent: '#c07a2a' },
      { id: 'gs-firmware', kind: 'article', title: 'Flash MicroPython firmware', accent: '#c2483a' },
      { id: 'gs-packages', kind: 'article', title: 'Install packages (mip)', accent: '#3f74ad' },
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
      {
        id: 'ref-language',
        kind: 'section',
        title: 'MicroPython Language',
        accent: A.language,
        children: [
          { id: 'ref-pins', kind: 'article', title: 'Pins & GPIO', accent: A.page },
          { id: 'ref-timing', kind: 'article', title: 'Timing', accent: A.page },
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
        id: 'ref-buses',
        kind: 'section',
        title: 'Buses',
        accent: A.buses,
        children: [
          { id: 'ref-i2c', kind: 'article', title: 'I²C', accent: A.page },
          { id: 'ref-spi', kind: 'article', title: 'SPI', accent: A.page },
          { id: 'ref-uart', kind: 'article', title: 'UART', accent: A.page },
          { id: 'ref-pwm', kind: 'article', title: 'PWM', accent: A.page }
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
  'ref-language'
])

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
  cursorLine?: string
): ProjectPart[] {
  if (!source) return []
  const lower = source.toLowerCase()
  const curLower = (cursorLine ?? '').toLowerCase()
  const out: ProjectPart[] = []
  const seen = new Set<string>()
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
  return out
}
