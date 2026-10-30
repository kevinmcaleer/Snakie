/**
 * EMBEDDABLE PARTS BUNDLE — snakie#1277, for kevinmcaleer/kevsrobots.com#254.
 * =============================================================================
 *
 * `npm run build:embed` → `dist-embed/snakie-parts.{js,css}`: an IIFE exposing
 * `window.SnakieParts`, so another site can mount three of Snakie's pieces into
 * its own pages, talking to its own API rather than `window.api`:
 *
 *  - {@link mountCatalog}     the full-screen parts catalog (PartCatalog)
 *  - {@link mountPartEditor}  the Part Editor (pins over a photo, symbol, shapes)
 *  - {@link mountWiring}      the wiring canvas, with BOM / pinout Markdown
 *  - {@link mountPartView}    a read-only part: pins over its photo, and its symbol
 *
 * plus the `parts.yml` and `robot.yml` helpers. The host passes libraries and
 * callbacks; the components reach the libraries through `window.api.parts`,
 * which {@link installPartsBackend} points at the host (see parts-backend.ts).
 * Everything is drawn inside a `.snakie-embed` element, and the bundle's CSS is
 * scoped to it at build time (vite.embed.config.ts), so the host's own styles
 * and Snakie's never meet. Docs: docs/embed.md.
 */
import '../lib/preloadFallback'
import { StrictMode, useCallback, useEffect, useMemo, useState, type JSX } from 'react'
import { createRoot, type Root } from 'react-dom/client'
// No @fontsource here: a lib build inlines every asset, and the two fonts
// would be over half a megabyte of base64 in the CSS. The host loads IBM Plex
// Mono and Plus Jakarta Sans itself (both are on Google Fonts); without them
// the tokens fall back to system fonts.
import '../index.css'
import './embed.css'
import { PartCatalog, type CatalogItem } from '../components/PartCatalog'
import { PartEditor } from '../components/PartEditor'
import { PartPreview } from '../components/PartPreview'
import { WiringCanvas, type WiringRenderMode } from '../components/WiringCanvas'
import { boardPartFor, resolveBoards } from '../components/part-editor.util'
import { BUILTIN_BOARDS } from '../components/board-defs'
import { planPartAdditions } from '../components/project-parts'
import { findPart, type PartDefinition, type PartLibraryWithParts } from '../../../shared/part'
import type { RobotDefinition } from '../../../shared/robot'
import { partFromYaml, partToYaml } from '../../../shared/part-yaml'
import { robotFromYaml, robotToYaml } from '../../../shared/robot-yaml'
import { bomMarkdown as robotBomMarkdown, pinoutMarkdown as robotPinoutMarkdown } from '../../../shared/robot-docs'
import { dataUrlToBlob, installPartsBackend, type EmbedWriteResult } from './parts-backend'

export type { PartsBackend } from './parts-backend'
export type { PartDefinition, PartLibraryWithParts, RobotDefinition }

/** What every mount returns. */
export interface Mounted {
  unmount(): void
}

/** The theme the components draw in: Snakie's skins, keyed off `data-theme`. */
export type EmbedTheme = 'skeuomorph' | 'dark' | 'light'

// One set of libraries backs `window.api.parts` for the whole page; every mount
// replaces it with its own, which is what the components then list.
let currentLibraries: PartLibraryWithParts[] = []
let saveHandler: ((libraryId: string, part: PartDefinition) => Promise<EmbedWriteResult>) | null = null

installPartsBackend({
  listLibraries: async () => currentLibraries,
  savePart: async (libraryId, part) =>
    saveHandler ? saveHandler(libraryId, part) : { ok: false, error: 'Saving is not set up on this page.' }
})

/** Wrap `el` in the scoped root every embedded component draws inside. */
function rootFor(el: HTMLElement, theme: EmbedTheme | undefined, extraClass: string): { root: Root; box: HTMLElement } {
  const box = document.createElement('div')
  box.className = `snakie-embed ${extraClass}`
  box.dataset.theme = theme === 'light' ? '' : (theme ?? 'skeuomorph')
  el.replaceChildren(box)
  return { root: createRoot(box), box }
}

function handle(root: Root, box: HTMLElement, after?: () => void): Mounted {
  return {
    unmount(): void {
      root.unmount()
      box.remove()
      after?.()
    }
  }
}

// ---------------------------------------------------------------- catalog

export interface CatalogOptions {
  libraries: PartLibraryWithParts[]
  /** The parts picked, when "Add to project" is pressed. */
  onAddMany(items: { libraryId: string; part: PartDefinition }[]): void
  /** The catalog closed (its close button, or Escape). */
  onClose?(): void
  /** Viewport point the catalog grows out of (the button that opened it). */
  origin?: { x: number; y: number } | null
  theme?: EmbedTheme
}

function CatalogHost({ opts, done }: { opts: CatalogOptions; done: () => void }): JSX.Element {
  const [closing, setClosing] = useState(false)
  const add = useCallback(
    (items: CatalogItem[]) => opts.onAddMany(items.map((i) => ({ libraryId: i.libraryId, part: i.part }))),
    [opts]
  )
  return (
    <PartCatalog
      libraries={opts.libraries}
      origin={opts.origin ?? null}
      closing={closing}
      onClose={() => setClosing(true)}
      onClosed={() => {
        opts.onClose?.()
        done()
      }}
      onAddMany={add}
    />
  )
}

/** Open the parts catalog in `el` (it fills the viewport, as in Snakie). */
export function mountCatalog(el: HTMLElement, opts: CatalogOptions): Mounted {
  currentLibraries = opts.libraries
  const { root, box } = rootFor(el, opts.theme, 'snakie-embed--catalog')
  const m = handle(root, box)
  root.render(
    <StrictMode>
      <CatalogHost opts={opts} done={() => m.unmount()} />
    </StrictMode>
  )
  return m
}

// ---------------------------------------------------------------- part editor

export interface PartEditorOptions {
  /** The part to edit; absent for a new one. Its photo is `imageData` (a URL). */
  part?: PartDefinition | null
  /** The library the part is saved into (shown in the editor). */
  libraryId?: string
  libraryName?: string
  /** Other libraries, e.g. the standard one, for footprints and reference boards. */
  libraries?: PartLibraryWithParts[]
  /** Save the part. `image` is the photo the user picked in the editor, when it
   *  is new (a `data:` URL in `part.imageData` becomes this Blob); resolve to
   *  `{ ok: false, error }` to show the error in the editor. */
  onSave(part: PartDefinition, image: Blob | null): Promise<EmbedWriteResult | void>
  onClose?(): void
  theme?: EmbedTheme
}

/** Open the Part Editor in `el`. */
export function mountPartEditor(el: HTMLElement, opts: PartEditorOptions): Mounted {
  const libraryId = opts.libraryId ?? 'host'
  const own: PartLibraryWithParts = {
    id: libraryId,
    name: opts.libraryName ?? 'Parts',
    parts: opts.part ? [opts.part] : []
  }
  currentLibraries = [own, ...(opts.libraries ?? []).filter((l) => l.id !== libraryId)]
  saveHandler = async (_lib, part) => {
    const image = dataUrlToBlob(part.imageData)
    const res = await opts.onSave(part, image)
    return res ?? { ok: true, id: part.id, libraryId }
  }
  const { root, box } = rootFor(el, opts.theme, 'snakie-embed--editor')
  const m = handle(root, box, () => {
    saveHandler = null
  })
  root.render(
    <StrictMode>
      <PartEditor
        libraryId={libraryId}
        initial={opts.part ?? null}
        isNew={!opts.part}
        existingParts={[]}
        libraries={currentLibraries}
        onClose={() => opts.onClose?.()}
        onSaved={() => undefined}
      />
    </StrictMode>
  )
  return m
}

// ---------------------------------------------------------------- wiring

export interface WiringOptions {
  /** The wiring: board, placed parts and connections (robot.yml's shape). */
  robot: RobotDefinition
  /** Libraries the placed parts (and the board) come from. */
  libraries: PartLibraryWithParts[]
  /** Every change to the wiring (moves, wires, parts placed or removed). */
  onChange(robot: RobotDefinition): void
  /** Life-like breadboard (default) or schematic. */
  view?: WiringRenderMode
  theme?: EmbedTheme
}

export interface WiringHandle extends Mounted {
  /** The wiring as it is now. */
  robot(): RobotDefinition
  /** Replace the wiring (e.g. after the host's BOM changed). */
  setRobot(robot: RobotDefinition): void
  /** Place library parts, each with a fresh instance id. */
  addParts(items: { libraryId: string; part: PartDefinition }[]): void
  setView(view: WiringRenderMode): void
  /** The canvas as a standalone SVG document, its images inlined. */
  exportSvg(): Promise<string>
  /** The Bill of Materials and pinout tables, as Markdown. */
  bomMarkdown(): string
  pinoutMarkdown(): string
}

interface WiringState {
  robot: RobotDefinition
  view: WiringRenderMode
}

function WiringHost({
  initial,
  libraries,
  onChange,
  bind
}: {
  initial: WiringState
  libraries: PartLibraryWithParts[]
  onChange: (r: RobotDefinition) => void
  bind: (set: (fn: (s: WiringState) => WiringState) => void) => void
}): JSX.Element {
  const [state, setState] = useState(initial)
  useEffect(() => bind(setState), [bind])
  const boards = useMemo(() => resolveBoards(libraries, []), [libraries])
  const def = boards.find((b) => b.id === state.robot.board) ?? boards[0] ?? BUILTIN_BOARDS[0]
  const boardPart = useMemo(() => boardPartFor(libraries, def.id), [libraries, def.id])
  const change = useCallback(
    (next: RobotDefinition) => {
      setState((s) => ({ ...s, robot: next }))
      onChange(next)
    },
    [onChange]
  )
  return (
    <WiringCanvas
      robot={state.robot}
      onChange={change}
      folder={null}
      libraries={libraries}
      boardDef={def}
      boardPart={boardPart}
      renderMode={state.view}
      onDropPart={(libraryId, part, pos) => {
        const { next } = planPartAdditions(state.robot, [{ libraryId, part, pos }], false)
        change(next)
      }}
    />
  )
}

/** Read an image into a `data:` URL; null when it can't be fetched (CORS). */
async function inlineImage(href: string): Promise<string | null> {
  if (href.startsWith('data:')) return href
  try {
    const res = await fetch(new URL(href, document.baseURI).href)
    if (!res.ok) return null
    const blob = await res.blob()
    return await new Promise<string>((ok, fail) => {
      const r = new FileReader()
      r.onload = () => ok(String(r.result))
      r.onerror = () => fail(r.error)
      r.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}

/**
 * The canvas as a standalone SVG file: computed colours written onto each
 * element (the CSS custom properties don't travel) and every `<image>` read
 * into a `data:` URL — an SVG shown through `<img>` loads nothing external, so
 * a part photo left as a link would be a blank box on the host's page.
 */
export async function svgDocument(svg: SVGSVGElement): Promise<string> {
  const copy = svg.cloneNode(true) as SVGSVGElement
  const src = svg.querySelectorAll('*')
  const dst = copy.querySelectorAll('*')
  const props = ['fill', 'stroke', 'stroke-width', 'opacity', 'font-family', 'font-size', 'font-weight']
  src.forEach((node, i) => {
    const cs = getComputedStyle(node as Element)
    const out = dst[i] as SVGElement
    const style = props.map((p) => `${p}:${cs.getPropertyValue(p)}`).join(';')
    out.setAttribute('style', `${style};${out.getAttribute('style') ?? ''}`)
  })
  copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  copy.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink')
  // A standalone file needs a real size: the canvas's own is "100%" of its box.
  const box = svg.getBoundingClientRect()
  const view = svg.viewBox?.baseVal
  const w = view?.width || box.width
  const h = view?.height || box.height
  copy.setAttribute('width', String(Math.round(w)))
  copy.setAttribute('height', String(Math.round(h)))
  const images = [...copy.querySelectorAll('image')]
  const seen = new Map<string, Promise<string | null>>()
  await Promise.all(
    images.map(async (img) => {
      const href = img.getAttribute('href') ?? img.getAttribute('xlink:href')
      if (!href) return
      if (!seen.has(href)) seen.set(href, inlineImage(href))
      const data = await seen.get(href)
      if (data) {
        img.setAttribute('href', data)
        img.removeAttribute('xlink:href')
      }
    })
  )
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(copy)
}

/** Open the wiring canvas in `el`. */
export function mountWiring(el: HTMLElement, opts: WiringOptions): WiringHandle {
  currentLibraries = opts.libraries
  let state: WiringState = { robot: opts.robot, view: opts.view ?? 'lifelike' }
  let set: ((fn: (s: WiringState) => WiringState) => void) | null = null
  const update = (fn: (s: WiringState) => WiringState): void => {
    state = fn(state)
    set?.(() => state)
  }
  const onChange = (next: RobotDefinition): void => {
    state = { ...state, robot: next }
    opts.onChange(next)
  }
  const { root, box } = rootFor(el, opts.theme, 'snakie-embed--wiring')
  const resolve = (lib: string, id: string): PartDefinition | null => findPart(opts.libraries, lib, id)
  const mcu = (): PartDefinition | null => boardPartFor(opts.libraries, state.robot.board ?? '')
  root.render(
    <StrictMode>
      <WiringHost
        initial={state}
        libraries={opts.libraries}
        onChange={onChange}
        bind={(s) => {
          set = s
          // Anything the host did between mount and this first effect.
          s(() => state)
        }}
      />
    </StrictMode>
  )
  return {
    ...handle(root, box),
    robot: () => state.robot,
    setRobot: (robot) => update((s) => ({ ...s, robot })),
    addParts: (items) => {
      const { next } = planPartAdditions(state.robot, items, false)
      update((s) => ({ ...s, robot: next }))
      opts.onChange(next)
    },
    setView: (view) => update((s) => ({ ...s, view })),
    exportSvg: () => {
      // The canvas's own drawing, not the toolbar icons around it.
      const svgs = [...box.querySelectorAll('svg')] as SVGSVGElement[]
      const svg = svgs.sort(
        (a, b) => b.getBoundingClientRect().width * b.getBoundingClientRect().height -
          a.getBoundingClientRect().width * a.getBoundingClientRect().height
      )[0]
      return svg ? svgDocument(svg) : Promise.resolve('')
    },
    bomMarkdown: () => robotBomMarkdown(state.robot, resolve, { mcu: mcu() }),
    pinoutMarkdown: () => robotPinoutMarkdown(state.robot, resolve, { mcuName: mcu()?.name })
  }
}

// ---------------------------------------------------------------- part view

export interface PartViewOptions {
  /** The part to show. Its photo is `imageData` (a URL). */
  part: PartDefinition
  /** Name each pin under the board as the pointer moves over it. Default true. */
  pinout?: boolean
  theme?: EmbedTheme
}

/** Show a part read-only in `el`: the board with its pins, and its schematic
 *  symbol, on Snakie's preview tabs (PartPreview). No 3-D tab: a mesh resolves
 *  only from a desktop parts folder, and the host has its own model viewer. */
export function mountPartView(el: HTMLElement, opts: PartViewOptions): Mounted {
  const { root, box } = rootFor(el, opts.theme, 'snakie-embed--view')
  root.render(
    <StrictMode>
      <PartPreview part={opts.part} libraryId="host" pinout={opts.pinout ?? true} />
    </StrictMode>
  )
  return handle(root, box)
}

// ---------------------------------------------------------------- formats

export { partFromYaml, partToYaml, robotFromYaml, robotToYaml }

/** The bundle's version (package.json's, at build time). */
export const version: string =
  (import.meta.env as unknown as { VITE_SNAKIE_VERSION?: string }).VITE_SNAKIE_VERSION ?? ''
