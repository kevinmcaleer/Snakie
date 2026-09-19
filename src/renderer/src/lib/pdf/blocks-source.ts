/**
 * WHERE THE EXPORT'S BLOCKS COME FROM — on screen or off it.
 *
 * The blocks pages used to read the live Blockly workspace and nothing else.
 * That workspace only exists while `BlocksCanvas` is mounted: press the print
 * button from the Code workspace, from Electronics or Build, or with the split
 * collapsed to its Python-only view, and there was no workspace to walk — so
 * the document went out with every other section in it and no blocks, and
 * nothing said so. "Sometimes it doesn't include the blocks" was exactly that.
 *
 * So the export now asks for a workspace in two steps:
 *
 *  1. the one on screen, when there is one — the learner's own arrangement,
 *     exactly as they see it; otherwise
 *  2. an OFF-SCREEN one built from the active file, the same way the canvas
 *     would build it if the Blocks view were opened: `blocksDocumentFor` reads
 *     the footer (or derives blocks from the Python), and the workspace is
 *     injected into a parked `<div>` with the canvas's own theme and renderer,
 *     loaded, photographed and thrown away.
 *
 * The off-screen path is what makes "always include the blocks" true. Any way
 * it can fail — a file with block types this build cannot read, a load that
 * throws — is thrown rather than swallowed, so `project-pdf` reports the
 * section as omitted and the status bar says so, instead of the quiet drop
 * this module exists to end.
 *
 * Loaded lazily by `export-project.ts`: it pulls in Blockly and the block
 * palette, which the toolbar's chunk must not.
 */

import * as Blockly from 'blockly/core'
import { arrangeWorkspaceRoots, separateWorkspaceRoots } from '../blocks/arrange'
import { blocksDocumentFor } from '../blocks/document'
import { ensureBlocklyLocale } from '../blocks/locale'
import { installCorePalette } from '../blocks/palette'
import { installBlockDefinitions } from '../blocks/registry'
import { installSoftShellRenderers } from '../blocks/renderer'
import { storedBlockShape } from '../../store/settings'
import {
  type BlocklyThemeInput,
  buildSoftShellTheme,
  readThemeTokens,
  softShellWorkspaceOptions
} from '../blocks/theme'
import { unknownBlockTypes } from '../blocks/workspace-check'
import { getBlocksWorkspace } from '../blocks/workspace-registry'
import { installShelfFlyout } from '../blocks/zoom'
// The escape-hatch fields' Monaco editor (#1018): a raw-Python block names a
// field type only this import registers, and deserialising one without it
// throws. Same side-effect import, for the same reason, as in `BlocksCanvas`.
import '../blocks/python-editor'

/** A workspace to photograph, and how to let go of it afterwards. */
export interface BlocksSource {
  workspace: Blockly.WorkspaceSvg
  /** True for the canvas on screen — it belongs to the learner, not to us. */
  live: boolean
  /** Take down what was built for the export. A no-op for the live one. */
  dispose: () => void
}

/** What the export knows about the active file. */
export interface BlocksSourceInput {
  /** The active file's name — only a `.py` has blocks. */
  entryFile?: string
  /** The active file's stored content, footer and all. */
  stored?: string | null
}

/** Does this file get a block canvas when the Blocks view is opened on it? */
export function hasBlocks(input: BlocksSourceInput): boolean {
  return typeof input.stored === 'string' && /\.py$/i.test(input.entryFile ?? '')
}

/** A `<div>` parked off-screen, big enough for a workspace to lay out in. */
function offscreenHost(): HTMLDivElement {
  const host = document.createElement('div')
  host.setAttribute('aria-hidden', 'true')
  host.dataset.snakiePdfHost = ''
  // Off-screen rather than hidden: `display: none` makes `getBBox()` zero and
  // the capture would measure nothing. Same trick as `wiring-capture.ts`.
  host.style.cssText =
    'position:fixed;left:-30000px;top:0;width:1400px;height:1000px;pointer-events:none;'
  document.body.appendChild(host)
  return host
}

/**
 * Build the file's blocks into a workspace nobody can see.
 *
 * Throws when the file cannot be read as blocks — the caller turns that into an
 * "exported without the blocks" report.
 */
export function offscreenBlocksSource(input: BlocksSourceInput): BlocksSource {
  const doc = blocksDocumentFor(input.stored ?? undefined)
  if (!doc) throw new Error('the file has no content to read blocks from')

  // Everything `Blockly.inject` needs to know first — the same calls, in the
  // same order, as the canvas's own injection. All idempotent.
  ensureBlocklyLocale()
  installCorePalette()
  installBlockDefinitions()
  installSoftShellRenderers()
  installShelfFlyout()

  // The canvas refuses a file it cannot read rather than clearing it (see the
  // `blocked` check in `BlocksCanvas`); the export refuses it too, out loud.
  const unknown = unknownBlockTypes(doc.workspace, (t) =>
    Object.prototype.hasOwnProperty.call(Blockly.Blocks, t)
  )
  if (unknown.length) {
    throw new Error(`the file uses blocks this Snakie does not know: ${unknown.join(', ')}`)
  }

  const host = offscreenHost()
  let ws: Blockly.WorkspaceSvg | null = null
  const dispose = (): void => {
    try {
      ws?.dispose()
    } finally {
      ws = null
      host.remove()
    }
  }
  try {
    const tokens = readThemeTokens(document.documentElement)
    ws = Blockly.inject(host, {
      // The shape the canvas is set to, so a printed page matches the screen
      // it was printed from.
      ...softShellWorkspaceOptions(tokens, storedBlockShape()),
      // No shelf: nothing is going to drag a block onto this one. It also keeps
      // the flyout's block canvas out of the SVG the capture frames.
      toolbox: undefined,
      readOnly: true,
      theme: Blockly.Theme.defineTheme(
        'snakie-soft-shell',
        buildSoftShellTheme(tokens) as BlocklyThemeInput
      )
    })
    // Off the undo stack and out of every listener's way — this workspace is
    // nobody's document.
    Blockly.Events.disable()
    try {
      Blockly.serialization.workspaces.load(doc.workspace, ws)
      // Laid out the way the canvas would lay it out: a derived document's
      // roots are only numbered, and a page of them a gutter apart is a page
      // of blocks drawn over each other.
      if (doc.derived) arrangeWorkspaceRoots(ws)
      else separateWorkspaceRoots(ws)
    } finally {
      Blockly.Events.enable()
    }
    return { workspace: ws, live: false, dispose }
  } catch (err) {
    dispose()
    throw err
  }
}

/**
 * The workspace the export should photograph: the live one when the canvas is
 * on screen, the file's own blocks otherwise, or null for a file with none.
 */
export function resolveBlocksSource(input: BlocksSourceInput): BlocksSource | null {
  const live = getBlocksWorkspace()
  if (live) return { workspace: live, live: true, dispose: () => {} }
  if (!hasBlocks(input)) return null
  return offscreenBlocksSource(input)
}
