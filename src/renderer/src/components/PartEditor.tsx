import { useEffect, useMemo, useRef, useState, type CSSProperties, type JSX } from 'react'
import { useHistory } from './use-history'
import { PartSchematicView } from './PartSchematicView'
import {
  PartCanvas,
  DEFAULT_LAYERS,
  DEFAULT_LOCKS,
  type CanvasSelection,
  type CanvasTool,
  type LayerVisibility,
  type LayerLocks
} from './PartCanvas'
import { pinOutwardDir } from './part-body'
import { bumpPatch } from '../../../shared/part-registry'
import {
  CAPABILITIES,
  CAPABILITY_LABEL,
  COMPONENT_SHAPES,
  COMPONENT_SHAPE_LABEL,
  PACKAGES,
  PART_EDGES,
  PIN_SHAPES,
  PIN_SHAPE_LABEL,
  PIN_TYPES,
  PIN_TYPE_LABEL,
  blankPart,
  collectUsedColors,
  normalisePart,
  orderedComponents,
  pinNames,
  pinShapeOf,
  reorderComponent,
  resolvedPins,
  sanitisePartId,
  validatePart,
  withPinPositions,
  withShapesFromFeatures
} from './part-editor.util'
import type {
  ComponentShape,
  ComponentShapeKind,
  ImageLayer,
  MountingHole,
  OnboardLed,
  PartButton,
  PartConnector,
  PartDefinition,
  PartHeader,
  PartLabel,
  PartLibrary,
  PartPin,
  PartPinBuses,
  PartPinCapability,
  PartPinShape,
  PartPinSignals,
  PartPinType,
  TextAlign
} from '../../../shared/part'
import type { PartsWriteResult } from '../../../preload/index.d'
import './PartEditor.css'

/** Per-capability bus/channel + signal controls shown when the capability is
 *  ticked: i2c/spi/uart carry a bus number + a signal, adc a channel number, pwm
 *  an A/B channel. */
const PIN_CAP_CONFIG: {
  cap: PartPinCapability
  label: string
  /** Show a numeric bus/channel field, keyed into {@link PartPinBuses}. */
  bus?: 'bus' | 'channel'
  /** Show a signal dropdown with these values, keyed into {@link PartPinSignals}. */
  signals?: string[]
}[] = [
  { cap: 'pwm', label: 'PWM', signals: ['A', 'B'] },
  { cap: 'adc', label: 'ADC', bus: 'channel' },
  { cap: 'spi', label: 'SPI', bus: 'bus', signals: ['RX', 'CSn', 'SCK', 'TX'] },
  { cap: 'i2c', label: 'I2C', bus: 'bus', signals: ['SDA', 'SCL'] },
  { cap: 'uart', label: 'UART', bus: 'bus', signals: ['TX', 'RX'] }
]

/** Default contacts for a new connector. QWIIC / STEMMA QT is a 4-pin JST-SH I2C
 *  socket in the order GND · 3V3 · SDA · SCL (SDA/SCL preset as i2c pins so you
 *  just assign their GP## + bus); a generic JST starts as four editable io pins. */
const QWIIC_PINS: PartPin[] = [
  { name: 'GND', type: 'gnd' },
  { name: '3V3', type: 'pwr' },
  { name: 'SDA', type: 'io', capabilities: ['i2c'], signals: { i2c: 'SDA' } },
  { name: 'SCL', type: 'io', capabilities: ['i2c'], signals: { i2c: 'SCL' } }
]
const JST_PINS: PartPin[] = [
  { name: 'PIN1', type: 'io' },
  { name: 'PIN2', type: 'io' },
  { name: 'PIN3', type: 'io' },
  { name: 'PIN4', type: 'io' }
]
/** Deep-clone connector prefill pins so connectors don't share nested refs. */
const cloneConnPins = (pins: PartPin[]): PartPin[] =>
  pins.map((p) => ({
    ...p,
    capabilities: p.capabilities ? [...p.capabilities] : undefined,
    signals: p.signals ? { ...p.signals } : undefined
  }))

/**
 * PART EDITOR (#130, layered-canvas redesign)
 * ===========================================
 *
 * A visual editor that authors a {@link PartDefinition} — the EXACT data the
 * Parts Library stores as `parts.yml`. Two views:
 *
 *  - **Breadboard** — an interactive, **layered canvas** ({@link PartCanvas}):
 *    a board shape (rect / polygon) → the board image on its own movable,
 *    resizable layer → free-placed pins, mounting holes and labels on top. A
 *    toolbar (select / pan / shape / pin / hole / text) drives placement; a
 *    contextual inspector edits the selected object. A **Life-like / Footprint**
 *    toggle just shows/hides the image layer (the footprint mirrors the
 *    life-like, minus the photo).
 *  - **Schematic** — a line-drawing symbol + the pad ↔ pin table.
 *
 * The on-disk YAML is the round-trippable source of truth (see
 * `part-editor.util.ts`). Hosted as a full-screen overlay in the main window.
 */

export interface PartEditorProps {
  /** Library the part is saved into (defaults to the local "my-parts"). */
  libraryId: string
  /** The part to edit, or null for a brand-new blank part. */
  initial: PartDefinition | null
  /** Treat `initial` as a brand-NEW part (a pre-seeded starter, e.g. "+ board"),
   *  so the id-collision guard stays armed even though `initial` carries an id. */
  isNew?: boolean
  /** Other parts in the same library (for the id-collision warning). */
  existingParts: PartDefinition[]
  /** All installed libraries (for the target-library selector). */
  libraries: PartLibrary[]
  /** Close the editor (back to the app). */
  onClose: () => void
  /** Called after a successful save so the panel can refresh + re-select. */
  onSaved: (libraryId: string, partId: string) => void
}

interface Status {
  kind: 'ok' | 'error' | 'info'
  text: string
}

/** Inline pixel-ish toolbar icons (currentColor, crisp). */
const ICON: Record<string, JSX.Element> = {
  select: (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M3 2l9 4.5-3.6 1.1L7 12z" fill="currentColor" />
    </svg>
  ),
  pan: (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="1.4">
        <path d="M8 1.5v13M1.5 8h13" />
        <path d="M8 1.5l-2 2M8 1.5l2 2M8 14.5l-2-2M8 14.5l2-2M1.5 8l2-2M1.5 8l2 2M14.5 8l-2-2M14.5 8l-2 2" />
      </g>
    </svg>
  ),
  fit: (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M2 5V2h3M11 2h3v3M14 11v3h-3M5 14H2v-3" />
      </g>
    </svg>
  ),
  text: (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M3 3h10v2.2h-1.1V4.2H8.6v7.6H10V13H6v-1.2h1.4V4.2H4.1v1H3z" fill="currentColor" />
    </svg>
  ),
  shapes: (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="1.4">
        <rect x="1.5" y="6.5" width="6" height="6" />
        <circle cx="11" cy="5" r="3.2" />
      </g>
    </svg>
  ),
  hole: (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="1.4">
        <circle cx="8" cy="8" r="6" />
        <circle cx="8" cy="8" r="2.2" />
      </g>
    </svg>
  ),
  button: (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="1.4">
        <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
        <circle cx="8" cy="8" r="3" />
      </g>
    </svg>
  ),
  undo: (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 4L2 7l3 3" />
        <path d="M2 7h7.5A3.5 3.5 0 0 1 13 10.5v0A3.5 3.5 0 0 1 9.5 14H6" />
      </g>
    </svg>
  ),
  redo: (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M11 4l3 3-3 3" />
        <path d="M14 7H6.5A3.5 3.5 0 0 0 3 10.5v0A3.5 3.5 0 0 0 6.5 14H10" />
      </g>
    </svg>
  )
}

/** Tool ids for each component shape kind the Shapes menu adds. */
const SHAPE_TOOL: Record<ComponentShapeKind, CanvasTool> = {
  rect: 'rect',
  circle: 'circle',
  polygon: 'cpoly'
}

/** A small dropdown in the toolbar that arms a component-shape add tool. */
function ShapesMenu({ tool, setTool }: { tool: CanvasTool; setTool: (t: CanvasTool) => void }): JSX.Element {
  const [open, setOpen] = useState(false)
  const active = tool === 'rect' || tool === 'circle' || tool === 'cpoly'
  return (
    <div className="pe__menu">
      <button
        type="button"
        className={`pe__iconbtn${active ? ' is-active' : ''}`}
        onClick={() => setOpen((o) => !o)}
        title="Add a component shape"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {ICON.shapes}
        <span className="pe__caret">▾</span>
      </button>
      {open && (
        <>
          <button type="button" className="pe__menu-backdrop" aria-hidden="true" tabIndex={-1} onClick={() => setOpen(false)} />
          <ul className="pe__menu-list" role="menu">
            {COMPONENT_SHAPES.map((k) => (
              <li key={k} role="none">
                <button
                  type="button"
                  role="menuitem"
                  className={`pe__menu-item${tool === SHAPE_TOOL[k] ? ' is-active' : ''}`}
                  onClick={() => {
                    setTool(SHAPE_TOOL[k])
                    setOpen(false)
                  }}
                >
                  {COMPONENT_SHAPE_LABEL[k]}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

/** Which lockable layer a selection belongs to (so a locked layer's items can't be
 *  selected/deleted/edited from the panel either, matching the canvas lock). */
function selectionLockKey(sel: CanvasSelection): keyof LayerLocks | null {
  if (!sel) return null
  switch (sel.type) {
    case 'pin':
      return 'pins'
    case 'hole':
      return 'holes'
    case 'button':
    case 'led':
    case 'connector':
    case 'shape':
    case 'shape-vertex':
    case 'label':
      return 'components'
    case 'vertex':
    case 'image':
      return 'image'
    default:
      return null
  }
}

export function PartEditor({
  libraryId,
  initial,
  isNew = false,
  existingParts,
  libraries,
  onClose,
  onSaved
}: PartEditorProps): JSX.Element {
  // Seed with every pin given an absolute x/y and legacy feature chips migrated
  // into editable component shapes (see withPinPositions / withShapesFromFeatures).
  // The transformed starting part (legacy features migrated to shapes, pin
  // positions resolved) — computed once and used to seed BOTH the editable state
  // and the last-saved baseline, so a no-edit save of a part with legacy
  // `features` doesn't spuriously bump its version (#172).
  const initialSeedRef = useRef<PartDefinition | null>(null)
  if (!initialSeedRef.current) {
    initialSeedRef.current = withShapesFromFeatures(withPinPositions(initial ?? blankPart()))
  }
  // The editable part lives in an undo/redo history (#187). EVERY edit routes
  // through `setPart` (incl. `patch` and the canvas's drag commits), so wrapping
  // this one value gives Ctrl+Z over all operations. `set` coalesces a drag's
  // many commits into one undo step; `resetHistory` clears it when a new part is
  // loaded (you can't undo across part loads).
  const {
    state: part,
    set: setPart,
    undo: undoHistory,
    redo: redoHistory,
    reset: resetHistory,
    canUndo,
    canRedo
  } = useHistory<PartDefinition>(initialSeedRef.current as PartDefinition)
  const [libId, setLibId] = useState<string>(libraryId)
  // A NEW part (incl. a pre-seeded starter) has no "opened" id, so the collision
  // guard treats its id as fresh and warns before overwriting an existing part.
  const [openedId, setOpenedId] = useState<string | null>(isNew ? null : (initial?.id ?? null))
  // The library the part was opened/last-saved from — so the collision guard only
  // stays silent when saving back to the SAME library with the same id.
  const [openedLibId, setOpenedLibId] = useState<string>(libraryId)
  const [propRows, setPropRows] = useState<[string, string][]>(() =>
    Object.entries(initial?.properties ?? {})
  )
  const [view, setView] = useState<'breadboard' | 'schematic'>('breadboard')
  const [locked, setLocked] = useState<LayerLocks>(DEFAULT_LOCKS)
  const [showGrid, setShowGrid] = useState(false)
  const [lockImageAspect, setLockImageAspect] = useState(true)
  // The board image's native pixel aspect (w/h), read off the loaded image so a
  // locked resize keeps its true proportions. Null until known / no image.
  const [imageNativeAspect, setImageNativeAspect] = useState<number | null>(null)
  const [snap, setSnap] = useState(false)
  const [tool, setTool] = useState<CanvasTool>('select')
  const [selection, setSelection] = useState<CanvasSelection>(null)
  const [fitSignal, setFitSignal] = useState(0)
  const [status, setStatus] = useState<Status | null>(null)
  // Auto-dismiss the status notification (e.g. "Saved …") so it doesn't linger
  // forever; errors hang around a bit longer than confirmations. Each new status
  // resets the timer via the effect cleanup.
  useEffect(() => {
    if (!status) return
    const t = setTimeout(() => setStatus(null), status.kind === 'error' ? 8000 : 4000)
    return () => clearTimeout(t)
  }, [status])
  const [detailsOpen, setDetailsOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // The content + version of the last save (or the opened part), so a save can
  // auto-bump the PATCH version when the part's content actually changed (#172).
  // Keyed by the canonical part minus its own version (version changes shouldn't
  // count as a content change, and a manual version edit is respected).
  const partContentKey = (p: PartDefinition): string => JSON.stringify({ ...normalisePart(p), version: undefined })
  const lastSavedRef = useRef<{ content: string; version?: string }>({
    content: partContentKey(initialSeedRef.current as PartDefinition),
    version: (initialSeedRef.current as PartDefinition).version
  })

  const fileId = useMemo(() => sanitisePartId(part.id), [part.id])
  const names = useMemo(() => pinNames(part), [part])

  // Read the image's native pixel aspect whenever the image changes (upload or a
  // re-opened part), so "lock aspect" can use the photo's true proportions.
  useEffect(() => {
    const data = part.imageData
    if (!data) {
      setImageNativeAspect(null)
      return
    }
    let cancelled = false
    const img = new Image()
    img.onload = () => {
      if (cancelled) return
      setImageNativeAspect(img.naturalWidth > 0 && img.naturalHeight > 0 ? img.naturalWidth / img.naturalHeight : null)
    }
    img.onerror = () => !cancelled && setImageNativeAspect(null)
    img.src = data
    return () => {
      cancelled = true
    }
  }, [part.imageData])

  /** The board outline aspect (w/h) — dimensions first, like the canvas. */
  const boardAspectOf = (p: PartDefinition): number =>
    p.dimensions && p.dimensions.width > 0 && p.dimensions.height > 0
      ? p.dimensions.width / p.dimensions.height
      : typeof p.aspect === 'number' && p.aspect > 0
        ? p.aspect
        : 0.6

  const patch = (p: Partial<PartDefinition>): void => setPart((d) => ({ ...d, ...p }))

  // Layer visibility is PERSISTED on the part, so the Parts Library preview and
  // the Board View respect what the author hid (e.g. a traced PCB image stays
  // hidden while its bytes are kept for later). Toggling patches the part.
  const visible: LayerVisibility = { ...DEFAULT_LAYERS, ...(part.layerVisibility ?? {}) }
  const setVisible: React.Dispatch<React.SetStateAction<LayerVisibility>> = (action) => {
    const next = typeof action === 'function' ? (action as (v: LayerVisibility) => LayerVisibility)(visible) : action
    patch({ layerVisibility: next })
  }

  // --- property rows (editable, blank-key rows survive while typing) --------
  const setProps = (rows: [string, string][]): void => {
    setPropRows(rows)
    const properties: Record<string, string> = {}
    for (const [k, v] of rows) if (k.trim()) properties[k] = v
    patch({ properties })
  }

  // --- image upload ---------------------------------------------------------
  const onPickImage = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        patch({ imageData: reader.result })
        setVisible((v) => ({ ...v, image: true }))
        setSelection({ type: 'image' })
        setTool('select')
        setStatus({ kind: 'info', text: 'Image added to the PCB layer — drag it / its corners to place + size it.' })
      }
    }
    reader.onerror = () => setStatus({ kind: 'error', text: 'Could not read that image.' })
    reader.readAsDataURL(file)
    e.target.value = ''
  }
  const removeImage = (): void => {
    setPart((d) => {
      const next = { ...d }
      delete next.imageData
      delete next.image
      delete next.imageLayer
      return next
    })
    if (selection?.type === 'image') setSelection(null)
  }
  const setImageLayer = (p: Partial<ImageLayer>): void => {
    const cur = part.imageLayer ?? { x: 0, y: 0, w: 1, h: 1 }
    patch({ imageLayer: { ...cur, ...p } })
  }
  // Toggle the lock; when turning it ON, immediately reshape the image layer to
  // the photo's native aspect (so an already-stretched image snaps back).
  const toggleLockAspect = (): void => {
    const next = !lockImageAspect
    setLockImageAspect(next)
    if (next && imageNativeAspect && imageNativeAspect > 0 && part.imageData) {
      const cur = part.imageLayer ?? { x: 0, y: 0, w: 1, h: 1 }
      // (w·boardAspect)/(h) === native  ⇒  h = w·boardAspect/native (box w/h ratio = boardAspect)
      patch({ imageLayer: { ...cur, h: (cur.w * boardAspectOf(part)) / imageNativeAspect } })
    }
  }

  // --- delete the selected object ------------------------------------------
  const deleteSelection = (): void => {
    const sel = selection
    if (!sel) return
    // A locked layer's items can't be deleted (keyboard or the Layers trash).
    const lk = selectionLockKey(sel)
    if (lk && locked[lk]) return
    if (sel.type === 'pin') {
      setPart((d) => ({
        ...d,
        headers: d.headers
          .map((h, i) => (i === sel.hi ? { ...h, pins: h.pins.filter((_, j) => j !== sel.pi) } : h))
          .filter((h) => h.pins.length > 0)
      }))
    } else if (sel.type === 'hole') {
      patch({ mountingHoles: (part.mountingHoles ?? []).filter((_, i) => i !== sel.index) })
    } else if (sel.type === 'button') {
      patch({ buttons: (part.buttons ?? []).filter((_, i) => i !== sel.index) })
    } else if (sel.type === 'led') {
      patch({ onboardLeds: (part.onboardLeds ?? []).filter((_, i) => i !== sel.index) })
    } else if (sel.type === 'connector') {
      patch({ connectors: (part.connectors ?? []).filter((_, i) => i !== sel.index) })
    } else if (sel.type === 'shape') {
      patch({ shapes: (part.shapes ?? []).filter((_, i) => i !== sel.index) })
    } else if (sel.type === 'shape-vertex') {
      // Delete a polygon vertex (keep ≥ 3); falls back to deleting nothing.
      patch({
        shapes: (part.shapes ?? []).map((s, i) =>
          i === sel.index && (s.points?.length ?? 0) > 3
            ? { ...s, points: (s.points ?? []).filter((_, v) => v !== sel.vi) }
            : s
        )
      })
    } else if (sel.type === 'label') {
      patch({ labels: (part.labels ?? []).filter((_, i) => i !== sel.index) })
    } else if (sel.type === 'vertex') {
      const poly = part.polygon ?? []
      if (poly.length > 3) patch({ polygon: poly.filter((_, i) => i !== sel.index) })
    } else if (sel.type === 'image') {
      removeImage()
    }
    setSelection(null)
  }

  // --- undo / redo (#187) ---------------------------------------------------
  // The property-rows table is editable state derived from part.properties, so
  // after an undo/redo (which restores the part) we resync it. The flag defers
  // the resync to the effect that fires once the restored `part` is committed.
  const resyncPropsRef = useRef(false)
  const undo = (): void => {
    if (!canUndo) return
    resyncPropsRef.current = true
    setSelection(null) // the previously selected object may not exist post-undo
    undoHistory()
  }
  const redo = (): void => {
    if (!canRedo) return
    resyncPropsRef.current = true
    setSelection(null)
    redoHistory()
  }
  useEffect(() => {
    if (!resyncPropsRef.current) return
    resyncPropsRef.current = false
    setPropRows(Object.entries(part.properties ?? {}))
  }, [part])

  // Delete / Backspace removes the selected object; Ctrl/Cmd+Z undoes and
  // Ctrl/Cmd+Shift+Z (or Ctrl+Y) redoes — but never while typing in a field, so
  // editing a name/number (and a text input's own native undo) isn't hijacked.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const el = document.activeElement as HTMLElement | null
      const tag = el?.tagName
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable
      const mod = e.metaKey || e.ctrlKey
      if (mod && (e.key === 'z' || e.key === 'Z')) {
        if (typing) return
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
        return
      }
      if (mod && (e.key === 'y' || e.key === 'Y')) {
        if (typing) return
        e.preventDefault()
        redo()
        return
      }
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      if (!selection) return
      if (typing) return
      e.preventDefault()
      deleteSelection()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // --- persistence ----------------------------------------------------------
  const newPart = (): void => {
    const seed = withShapesFromFeatures(withPinPositions(blankPart()))
    resetHistory(seed) // a new part starts a fresh undo history
    setPropRows([])
    setOpenedId(null)
    setSelection(null)
    // Reset the version baseline so the fresh part's first save keeps its version (#172).
    lastSavedRef.current = { content: partContentKey(seed), version: seed.version }
    setStatus({ kind: 'info', text: 'Started a new blank part.' })
  }

  const save = async (): Promise<void> => {
    const err = validatePart(part)
    if (err) {
      setStatus({ kind: 'error', text: err })
      return
    }
    const clean = normalisePart(part)
    // Check the id collision against the destination library's CURRENT parts,
    // read fresh here so switching the Library dropdown can't race a stale list.
    let destParts: PartDefinition[] = existingParts
    try {
      const libs = await window.api.parts.listLibraries()
      destParts = libs.find((l) => l.id === libId)?.parts ?? []
    } catch {
      // Fall back to the parts we were given if the read fails.
    }
    // Only suppress the warning when saving back to the SAME library + id we
    // opened (an in-place edit); a same-id part in a DIFFERENT library is a real
    // collision we must not silently overwrite.
    const sameTarget = openedLibId === libId && sanitisePartId(openedId ?? '') === clean.id
    const collision = !sameTarget && destParts.some((p) => sanitisePartId(p.id) === clean.id)
    if (collision) {
      setStatus({
        kind: 'error',
        text: `A part with id "${clean.id}" already exists in this library. Rename it, or open it to edit.`
      })
      return
    }
    // Auto-bump the PATCH version when an EDIT changed the content (#172), so the
    // update is detectable — unless the user manually changed the version this
    // session (then their value wins). New parts keep their authored version.
    const contentChanged = partContentKey(clean) !== lastSavedRef.current.content
    const versionUntouched = (clean.version ?? '') === (lastSavedRef.current.version ?? '')
    // Only auto-bump an EDIT of an already-saved/opened part; a brand-new part's
    // first save keeps its authored version (openedId is null until first save).
    const nextVersion =
      contentChanged && versionUntouched && openedId !== null ? bumpPatch(clean.version) : clean.version
    const payload: PartDefinition = { ...clean, version: nextVersion, imageData: part.imageData }
    try {
      const res: PartsWriteResult = await window.api.parts.savePart(libId, payload)
      if (res?.ok) {
        setOpenedId(clean.id)
        setOpenedLibId(res.libraryId ?? libId)
        lastSavedRef.current = { content: partContentKey(payload), version: nextVersion }
        if (nextVersion !== part.version) patch({ version: nextVersion }) // reflect the bump in the field
        setStatus({ kind: 'ok', text: `Saved "${clean.name}" to ${res.libraryId ?? libId} (v${nextVersion}).` })
        onSaved(res.libraryId ?? libId, res.id ?? clean.id)
      } else {
        setStatus({ kind: 'error', text: res?.error ?? 'Save failed.' })
      }
    } catch (e) {
      // Never let a thrown IPC error fail silently (the button would look dead).
      setStatus({ kind: 'error', text: `Save failed: ${(e as Error)?.message ?? 'unknown error'}` })
    }
  }

  return (
    <div className="pe" role="dialog" aria-label="Part Editor" aria-modal="true">
      <header className="pe__bar">
        <span className="pe__title">PART EDITOR</span>
        <div className="pe__viewtabs" role="tablist" aria-label="Editor view">
          <button
            type="button"
            role="tab"
            aria-selected={view === 'breadboard'}
            className={`pe__tab${view === 'breadboard' ? ' is-active' : ''}`}
            onClick={() => setView('breadboard')}
          >
            Breadboard
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'schematic'}
            className={`pe__tab${view === 'schematic' ? ' is-active' : ''}`}
            onClick={() => setView('schematic')}
          >
            Schematic
          </button>
        </div>
        <label className="pe__libsel" title="The parts library this part is saved into">
          <span>Saved to</span>
          <select value={libId} onChange={(e) => setLibId(e.target.value)}>
            {!libraries.some((l) => l.id === 'my-parts') && (
              <option value="my-parts">My Parts (your library)</option>
            )}
            {libraries.map((l) => (
              <option key={l.id} value={l.id}>
                {l.id === 'my-parts' ? `${l.name} (your library)` : l.name}
              </option>
            ))}
          </select>
        </label>
        <div className="pe__bar-actions">
          <button type="button" className="pe__btn" onClick={newPart} title="Start a new blank part">
            New
          </button>
          <button type="button" className="pe__btn pe__btn--primary" onClick={save} title="Save this part">
            Save
          </button>
          <button type="button" className="pe__btn" onClick={onClose} title="Close the editor">
            Done
          </button>
        </div>
      </header>

      {status && (
        <div className={`pe__status pe__status--${status.kind}`} role="status">
          {status.text}
        </div>
      )}

      <div className="pe__body">
        {view === 'breadboard' ? (
          <>
            {/* Canvas takes the lion's share on the LEFT */}
            <div className="pe__canvaspane">
              <div className="pe__toolbar">
                <button type="button" className={`pe__iconbtn${tool === 'select' ? ' is-active' : ''}`} onClick={() => setTool('select')} title="Select & move objects" aria-label="Select">
                  {ICON.select}
                </button>
                <button type="button" className={`pe__iconbtn${tool === 'move' ? ' is-active' : ''}`} onClick={() => setTool('move')} title="Pan (drag); scroll to zoom" aria-label="Pan">
                  {ICON.pan}
                </button>
                <button type="button" className="pe__iconbtn" onClick={() => setFitSignal((n) => n + 1)} title="Fit / reset the view" aria-label="Fit">
                  {ICON.fit}
                </button>
                <span className="pe__divider" />
                <button type="button" className="pe__iconbtn" onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)" aria-label="Undo">
                  {ICON.undo}
                </button>
                <button type="button" className="pe__iconbtn" onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)" aria-label="Redo">
                  {ICON.redo}
                </button>
                <span className="pe__divider" />
                <ShapesMenu tool={tool} setTool={setTool} />
                <button type="button" className={`pe__iconbtn${tool === 'text' ? ' is-active' : ''}`} onClick={() => setTool('text')} title="Add a text label" aria-label="Text">
                  {ICON.text}
                </button>
                <button type="button" className={`pe__iconbtn${tool === 'hole' ? ' is-active' : ''}`} onClick={() => setTool('hole')} title="Add a mounting hole" aria-label="Mounting hole">
                  {ICON.hole}
                </button>
                <button type="button" className={`pe__iconbtn${tool === 'button' ? ' is-active' : ''}`} onClick={() => setTool('button')} title="Add a push-button" aria-label="Push-button">
                  {ICON.button}
                </button>
              </div>
              <div className="pe__canvas-stage">
                <PartCanvas
                  part={part}
                  visible={visible}
                  locked={locked}
                  showGrid={showGrid}
                  snap={snap}
                  lockAspect={lockImageAspect}
                  imageNativeAspect={imageNativeAspect}
                  tool={tool}
                  selection={selection}
                  onChange={setPart}
                  onSelect={setSelection}
                  onNotify={(msg) => setStatus({ kind: 'info', text: msg })}
                  onToggleGrid={() => setShowGrid((g) => !g)}
                  onToggleSnap={() => setSnap((s) => !s)}
                  resetSignal={fitSignal}
                />
              </div>
            </div>

            {/* Properties on the RIGHT (~1/4 width) — Details at the top. */}
            <div className="pe__panels pe__panels--right">
              <DetailsSection
                part={part}
                patch={patch}
                propRows={propRows}
                setProps={setProps}
                detailsOpen={detailsOpen}
                setDetailsOpen={setDetailsOpen}
                fileId={fileId}
              />
              <LayersPanel
                variant="layers"
                part={part}
                visible={visible}
                setVisible={setVisible}
                locked={locked}
                setLocked={setLocked}
                tool={tool}
                setTool={setTool}
                selection={selection}
                setSelection={setSelection}
                onDeleteSelected={deleteSelection}
                fileInputRef={fileInputRef}
                onPickImage={onPickImage}
                patch={patch}
              />
              <Inspector
                part={part}
                selection={selection}
                names={names}
                propRows={propRows}
                setProps={setProps}
                detailsOpen={detailsOpen}
                setDetailsOpen={setDetailsOpen}
                fileId={fileId}
                fileInputRef={fileInputRef}
                onPickImage={onPickImage}
                removeImage={removeImage}
                setImageLayer={setImageLayer}
                lockImageAspect={lockImageAspect}
                onToggleLockAspect={toggleLockAspect}
                patch={patch}
                setPart={setPart}
                deleteSelection={deleteSelection}
              />
              {/* Board structure (mounting holes + PCB + image) sits BELOW the
                  selected-item details, so pin editing stays near the top. */}
              <LayersPanel
                variant="board"
                part={part}
                visible={visible}
                setVisible={setVisible}
                locked={locked}
                setLocked={setLocked}
                tool={tool}
                setTool={setTool}
                selection={selection}
                setSelection={setSelection}
                onDeleteSelected={deleteSelection}
                fileInputRef={fileInputRef}
                onPickImage={onPickImage}
                patch={patch}
              />
            </div>
          </>
        ) : (
          <>
            <div className="pe__panels">
              <SchematicPanels part={part} patch={patch} />
            </div>
            <div className="pe__preview">
              <div className="pe__preview-head">
                <span className="pe__preview-title">Schematic symbol</span>
              </div>
              <div className="pe__preview-stage">
                <PartSchematicView part={part} />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// --- Layers panel -----------------------------------------------------------

interface LayersPanelProps {
  part: PartDefinition
  visible: LayerVisibility
  setVisible: React.Dispatch<React.SetStateAction<LayerVisibility>>
  locked: LayerLocks
  setLocked: React.Dispatch<React.SetStateAction<LayerLocks>>
  tool: CanvasTool
  setTool: (t: CanvasTool) => void
  selection: CanvasSelection
  setSelection: (s: CanvasSelection) => void
  onDeleteSelected: () => void
  fileInputRef: React.RefObject<HTMLInputElement>
  onPickImage: (e: React.ChangeEvent<HTMLInputElement>) => void
  patch: (p: Partial<PartDefinition>) => void
  /** Which sections to show: 'layers' = Components + Pins; 'board' = Mounting holes
   *  + PCB + Image. Lets the board layers sit BELOW the selection inspector. */
  variant?: 'layers' | 'board'
}

/**
 * The Layers panel — the board "stack", top → bottom: Components, Pins, Mounting
 * holes, PCB. Each layer has a visibility toggle, a count, an add affordance, and
 * a collapsible list of its items (click one to select it on the canvas).
 */
function LayersPanel({
  part,
  visible,
  setVisible,
  locked,
  setLocked,
  tool,
  setTool,
  selection,
  setSelection,
  onDeleteSelected,
  fileInputRef,
  onPickImage,
  patch,
  variant = 'layers'
}: LayersPanelProps): JSX.Element {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const pins = resolvedPins(part)
  // The Pins list reads best sorted: by board number when a pin has one (numbered
  // pins first, ascending), otherwise by the pin's label text (numeric-aware, so
  // GP2 sorts before GP10). Selection still keys off the stable hi/pi.
  const sortedPins = [...pins].sort((a, b) => {
    const an = a.pin.number
    const bn = b.pin.number
    const aHas = typeof an === 'number'
    const bHas = typeof bn === 'number'
    if (aHas && bHas) return an - bn
    if (aHas !== bHas) return aHas ? -1 : 1
    const al = a.pin.label || a.pin.name || ''
    const bl = b.pin.label || b.pin.name || ''
    return al.localeCompare(bl, undefined, { numeric: true, sensitivity: 'base' })
  })
  const holes = part.mountingHoles ?? []
  const buttons = part.buttons ?? []
  const onboardLeds = part.onboardLeds ?? []
  const connectors = part.connectors ?? []
  const shapes = part.shapes ?? []
  const labels = part.labels ?? []
  const counts = {
    components: shapes.length + labels.length,
    pins: pins.length,
    holes: holes.length,
    buttons: buttons.length,
    leds: onboardLeds.length,
    connectors: connectors.length,
    image: part.imageData ? 1 : 0
  }
  /** Append an onboard LED at the board centre and select it (type set in the
   *  inspector: LED / RGB / NeoPixel). */
  const addLed = (kind: 'single' | 'rgb' | 'neopixel' = 'single'): void => {
    const next = [...onboardLeds, { kind, x: 0.5, y: 0.5 } as (typeof onboardLeds)[number]]
    patch({ onboardLeds: next })
    setSelection({ type: 'led', index: next.length - 1 })
  }
  /** Append a connector (QWIIC/STEMMA QT or generic JST) at the centre + select it. */
  const addConnector = (kind: 'qwiic' | 'jst'): void => {
    const pins = cloneConnPins(kind === 'qwiic' ? QWIIC_PINS : JST_PINS)
    const next = [...connectors, { kind, x: 0.5, y: 0.5, pins }]
    patch({ connectors: next })
    setSelection({ type: 'connector', index: next.length - 1 })
  }
  const toggleVis = (key: keyof LayerVisibility): void => setVisible((v) => ({ ...v, [key]: !v[key] }))
  const eye = (key: keyof LayerVisibility): JSX.Element => (
    <input
      type="checkbox"
      className="pe__eye"
      checked={visible[key]}
      onChange={() => toggleVis(key)}
      title={visible[key] ? 'Hide layer' : 'Show layer'}
      aria-label={`${visible[key] ? 'Hide' : 'Show'} layer`}
    />
  )
  const toggleLock = (key: keyof LayerLocks): void => {
    const willLock = !locked[key]
    setLocked((l) => ({ ...l, [key]: !l[key] }))
    // Locking a layer drops a selection that belongs to it, so its items can't
    // then be edited via the inspector either.
    if (willLock && selectionLockKey(selection) === key) setSelection(null)
  }
  /** A padlock toggle so a layer can be frozen (e.g. the background PCB). */
  const lock = (key: keyof LayerLocks): JSX.Element => (
    <button
      type="button"
      className={`pe__lock${locked[key] ? ' is-locked' : ''}`}
      onClick={() => toggleLock(key)}
      title={locked[key] ? 'Unlock layer (allow editing)' : 'Lock layer (prevent editing)'}
      aria-label={`${locked[key] ? 'Unlock' : 'Lock'} layer`}
      aria-pressed={locked[key]}
    >
      {locked[key] ? '🔒' : '🔓'}
    </button>
  )
  const isOpen = (id: string): boolean => !collapsed[id]
  const caret = (id: string): JSX.Element => (
    <button type="button" className="pe__layer-caret" onClick={() => setCollapsed((c) => ({ ...c, [id]: !c[id] }))} aria-expanded={isOpen(id)} title={isOpen(id) ? 'Collapse' : 'Expand'}>
      {isOpen(id) ? '▾' : '▸'}
    </button>
  )
  const selEq = (a: CanvasSelection): boolean => JSON.stringify(a) === JSON.stringify(selection)
  /** A `−` button that deletes the selected item, enabled when `active`. */
  const delBtn = (active: boolean): JSX.Element => (
    <button
      type="button"
      className="pe__chip pe__chip--del"
      disabled={!active}
      onClick={onDeleteSelected}
      title={active ? 'Delete the selected item' : 'Select an item to delete it'}
      aria-label="Delete selected item"
    >
      −
    </button>
  )
  const setShape = (kind: 'rect' | 'polygon'): void => {
    if (kind === 'polygon' && (part.polygon?.length ?? 0) < 3) {
      patch({
        shape: { kind },
        polygon: [
          { x: 0.05, y: 0.05 },
          { x: 0.95, y: 0.05 },
          { x: 0.95, y: 0.95 },
          { x: 0.05, y: 0.95 }
        ]
      })
    } else {
      patch({ shape: { kind } })
    }
    if (kind === 'rect' && tool === 'shape') setTool('select')
  }
  /** Restack a component one step (dir +1 = forward/on top, -1 = backward). */
  const moveComponent = (kind: 'shape' | 'label', index: number, dir: 1 | -1): void => {
    const next = reorderComponent(part, { kind, index }, dir)
    patch({ shapes: next.shapes, labels: next.labels })
  }

  return (
    <section className="pe__section pe__layers">
      <h3 className="pe__h">{variant === 'board' ? 'Board' : 'Layers'}</h3>

      {variant !== 'board' && (
        <>
      {/* Components (top) */}
      <div className={`pe__layer${tool === 'rect' || tool === 'circle' || tool === 'cpoly' || tool === 'text' ? ' is-active' : ''}`}>
        <div className="pe__layer-head">
          {caret('components')}
          {eye('components')}
          {lock('components')}
          <span className="pe__layer-name">Components</span>
          <span className="pe__layer-count">{counts.components}</span>
          {delBtn((selection?.type === 'shape' || selection?.type === 'shape-vertex' || selection?.type === 'label') && !locked.components)}
        </div>
        {isOpen('components') && (
          <ul className="pe__layer-list">
            {counts.components === 0 && <li className="pe__layer-empty">Add shapes from the toolbar ▸ Shapes.</li>}
            {/* One list across shapes + labels in draw order, TOP-MOST FIRST. The
                ▲/▼ buttons restack a component (top of the list draws on top). */}
            {orderedComponents(part)
              .slice()
              .reverse()
              .map((c, ri, rows) => {
                const isShape = c.kind === 'shape'
                const name = isShape ? shapes[c.index].label || shapes[c.index].kind : labels[c.index].text || '(label)'
                const sub = isShape ? shapes[c.index].kind : 'text'
                const active = isShape
                  ? (selection?.type === 'shape' || selection?.type === 'shape-vertex') && selection.index === c.index
                  : selEq({ type: 'label', index: c.index })
                const sel: CanvasSelection = isShape ? { type: 'shape', index: c.index } : { type: 'label', index: c.index }
                return (
                  <li key={`${c.kind}${c.index}`} className="pe__item-row">
                    <button type="button" disabled={locked.components} className={`pe__item${active ? ' is-active' : ''}`} onClick={() => setSelection(sel)}>
                      <span className="pe__item-name">{name}</span>
                      <span className="pe__item-sub">{sub}</span>
                    </button>
                    <div className="pe__item-order">
                      <button type="button" className="pe__ordbtn" disabled={ri === 0 || locked.components} title="Bring forward (draw on top)" aria-label="Bring forward" onClick={() => moveComponent(c.kind, c.index, 1)}>
                        ▲
                      </button>
                      <button type="button" className="pe__ordbtn" disabled={ri === rows.length - 1 || locked.components} title="Send backward (draw underneath)" aria-label="Send backward" onClick={() => moveComponent(c.kind, c.index, -1)}>
                        ▼
                      </button>
                    </div>
                  </li>
                )
              })}
          </ul>
        )}
      </div>

      {/* Pins */}
      <div className={`pe__layer${tool === 'pin' ? ' is-active' : ''}`}>
        <div className="pe__layer-head">
          {caret('pins')}
          {eye('pins')}
          {lock('pins')}
          <span className="pe__layer-name">Pins</span>
          <span className="pe__layer-count">{counts.pins}</span>
          <button type="button" className={`pe__chip pe__chip--add${tool === 'pin' ? ' is-active' : ''}`} onClick={() => setTool('pin')} title="Click the board to add a pin">
            ＋
          </button>
          {delBtn(selection?.type === 'pin' && !locked.pins)}
        </div>
        {isOpen('pins') && (
          <ul className="pe__layer-list">
            {pins.length === 0 && <li className="pe__layer-empty">No pins yet.</li>}
            {sortedPins.map((rp) => (
              <li key={`p${rp.hi}-${rp.pi}`}>
                <button type="button" disabled={locked.pins} className={`pe__item${selEq({ type: 'pin', hi: rp.hi, pi: rp.pi }) ? ' is-active' : ''}`} onClick={() => setSelection({ type: 'pin', hi: rp.hi, pi: rp.pi })}>
                  <span className="pe__item-name">{rp.pin.name || '(pin)'}</span>
                  <span className="pe__item-sub">{rp.pin.type}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Onboard LEDs (LED / RGB / NeoPixel) tied to GPIO(s). Kept in the top
          panel — right above the selection inspector — so their GPIO config is one
          click away (no scrolling). Added here, then dragged into place. */}
      <div className="pe__layer">
        <div className="pe__layer-head">
          {caret('leds')}
          <span className="pe__layer-name">Onboard LEDs</span>
          <span className="pe__layer-count">{counts.leds}</span>
          <button type="button" className="pe__chip pe__chip--add" onClick={() => addLed()} title="Add an onboard LED — pick LED / RGB / NeoPixel and assign GPIO(s) in the inspector">
            ＋ LED
          </button>
          {delBtn(selection?.type === 'led' && !locked.components)}
        </div>
        {isOpen('leds') && (
          <ul className="pe__layer-list">
            {onboardLeds.length === 0 && <li className="pe__layer-empty">No onboard LEDs yet.</li>}
            {onboardLeds.map((l, i) => (
              <li key={`led${i}`}>
                <button type="button" disabled={locked.components} className={`pe__item${selEq({ type: 'led', index: i }) ? ' is-active' : ''}`} onClick={() => setSelection({ type: 'led', index: i })}>
                  <span className="pe__item-name">
                    {l.label || (l.kind === 'rgb' ? 'RGB' : l.kind === 'neopixel' ? 'NeoPixel' : 'LED')} {i + 1}
                  </span>
                  <span className="pe__item-sub">{l.kind}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Connectors (QWIIC / STEMMA QT / JST). Their pins are full pins — assign a
          GP## + I2C bus to SDA/SCL in the inspector — added here then dragged. */}
      <div className="pe__layer">
        <div className="pe__layer-head">
          {caret('connectors')}
          <span className="pe__layer-name">Connectors</span>
          <span className="pe__layer-count">{counts.connectors}</span>
          <button type="button" className="pe__chip pe__chip--add" onClick={() => addConnector('qwiic')} title="Add a QWIIC / STEMMA QT (4-pin JST-SH I2C) connector">
            ＋QWIIC
          </button>
          <button type="button" className="pe__chip pe__chip--add" onClick={() => addConnector('jst')} title="Add a generic JST connector (4 editable pins)">
            ＋JST
          </button>
          {delBtn(selection?.type === 'connector' && !locked.components)}
        </div>
        {isOpen('connectors') && (
          <ul className="pe__layer-list">
            {connectors.length === 0 && <li className="pe__layer-empty">No connectors yet.</li>}
            {connectors.map((c, i) => (
              <li key={`conn${i}`}>
                <button type="button" disabled={locked.components} className={`pe__item${selEq({ type: 'connector', index: i }) ? ' is-active' : ''}`} onClick={() => setSelection({ type: 'connector', index: i })}>
                  <span className="pe__item-name">{c.label || (c.kind === 'qwiic' ? 'QWIIC' : 'JST')} {i + 1}</span>
                  <span className="pe__item-sub">{c.pins.length}-pin</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

        </>
      )}

      {variant === 'board' && (
        <>
      {/* Mounting holes */}
      <div className={`pe__layer${tool === 'hole' ? ' is-active' : ''}`}>
        <div className="pe__layer-head">
          {caret('holes')}
          {eye('holes')}
          {lock('holes')}
          <span className="pe__layer-name">Mounting holes</span>
          <span className="pe__layer-count">{counts.holes}</span>
          <button type="button" className={`pe__chip pe__chip--add${tool === 'hole' ? ' is-active' : ''}`} onClick={() => setTool('hole')} title="Click the board to add a mounting hole (pins can't sit in holes)">
            ＋
          </button>
          {delBtn(selection?.type === 'hole' && !locked.holes)}
        </div>
        {isOpen('holes') && (
          <ul className="pe__layer-list">
            {holes.length === 0 && <li className="pe__layer-empty">No holes yet.</li>}
            {holes.map((h, i) => (
              <li key={`h${i}`}>
                <button type="button" disabled={locked.holes} className={`pe__item${selEq({ type: 'hole', index: i }) ? ' is-active' : ''}`} onClick={() => setSelection({ type: 'hole', index: i })}>
                  <span className="pe__item-name">Hole {i + 1}</span>
                  <span className="pe__item-sub">⌀{h.diameter}mm</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* On-board buttons (#130) — push-buttons like BOOT/RESET. They live on the
          Components layer, so its eye/lock govern their visibility. */}
      <div className={`pe__layer${tool === 'button' ? ' is-active' : ''}`}>
        <div className="pe__layer-head">
          {caret('buttons')}
          <span className="pe__layer-name">Buttons</span>
          <span className="pe__layer-count">{counts.buttons}</span>
          <button type="button" className={`pe__chip pe__chip--add${tool === 'button' ? ' is-active' : ''}`} onClick={() => setTool('button')} title="Click the board to add a push-button">
            ＋
          </button>
          {delBtn(selection?.type === 'button' && !locked.components)}
        </div>
        {isOpen('buttons') && (
          <ul className="pe__layer-list">
            {buttons.length === 0 && <li className="pe__layer-empty">No buttons yet.</li>}
            {buttons.map((b, i) => (
              <li key={`btn${i}`}>
                <button type="button" disabled={locked.components} className={`pe__item${selEq({ type: 'button', index: i }) ? ' is-active' : ''}`} onClick={() => setSelection({ type: 'button', index: i })}>
                  <span className="pe__item-name">{b.label || `Button ${i + 1}`}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* PCB body (outline + fill) — its own toggle so board-less parts (motors)
          can hide it independently of the photo. */}
      <div className={`pe__layer pe__layer--pcb${tool === 'shape' ? ' is-active' : ''}`}>
        <div className="pe__layer-head">
          {eye('pcb')}
          {lock('image')}
          <span className="pe__layer-name">PCB</span>
        </div>
        <div className="pe__layer-tools">
          <select className="pe__chip-select" value={part.shape?.kind ?? 'rect'} onChange={(e) => setShape(e.target.value as 'rect' | 'polygon')} title="Board outline shape">
            <option value="rect">Rectangle</option>
            <option value="polygon">Polygon</option>
          </select>
          {part.shape?.kind === 'polygon' && (
            <button type="button" className={`pe__chip${tool === 'shape' ? ' is-active' : ''}`} onClick={() => setTool('shape')} title="Drag the polygon vertices (or click an edge to add one)">
              Edit shape
            </button>
          )}
        </div>
      </div>

      {/* Image (board photo) — separate toggle from the PCB body. */}
      <div className="pe__layer">
        <div className="pe__layer-head">
          {eye('image')}
          <span className="pe__layer-name">Image</span>
          <span className="pe__layer-count">{counts.image ? 'img' : '—'}</span>
        </div>
        <div className="pe__layer-tools">
          <button type="button" className="pe__chip" onClick={() => fileInputRef.current?.click()} title="Upload a board photo onto the PCB layer">
            {part.imageData ? 'Replace image' : '＋ Image'}
          </button>
        </div>
        <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/svg+xml" style={{ display: 'none' }} onChange={onPickImage} />
      </div>
      <p className="pe__hint pe__hint--muted">PCB on the bottom; holes cut through it; pins &amp; components on top.</p>
        </>
      )}
    </section>
  )
}

// --- Breadboard inspector ---------------------------------------------------

interface InspectorProps {
  part: PartDefinition
  selection: CanvasSelection
  names: string[]
  propRows: [string, string][]
  setProps: (rows: [string, string][]) => void
  detailsOpen: boolean
  setDetailsOpen: (b: boolean) => void
  fileId: string
  fileInputRef: React.RefObject<HTMLInputElement>
  onPickImage: (e: React.ChangeEvent<HTMLInputElement>) => void
  removeImage: () => void
  setImageLayer: (p: Partial<ImageLayer>) => void
  lockImageAspect: boolean
  onToggleLockAspect: () => void
  patch: (p: Partial<PartDefinition>) => void
  setPart: React.Dispatch<React.SetStateAction<PartDefinition>>
  deleteSelection: () => void
}

function Inspector(props: InspectorProps): JSX.Element {
  const { part, patch } = props
  return (
    <>
      {/* Contextual: the selected object */}
      <SelectionInspector {...props} />

      {/* Board size + appearance (shape + image live in the Layers panel) */}
      <section className="pe__section">
        <h3 className="pe__h">Board</h3>
        <div className="pe__row">
          <label className="pe__field">
            <span>Width (mm)</span>
            <input
              type="number"
              step="0.1"
              value={part.dimensions?.width ?? ''}
              onChange={(e) =>
                patch({ dimensions: { width: Number(e.target.value) || 0, height: part.dimensions?.height ?? 0 } })
              }
            />
          </label>
          <label className="pe__field">
            <span>Height (mm)</span>
            <input
              type="number"
              step="0.1"
              value={part.dimensions?.height ?? ''}
              onChange={(e) =>
                patch({ dimensions: { width: part.dimensions?.width ?? 0, height: Number(e.target.value) || 0 } })
              }
            />
          </label>
        </div>
        <div className="pe__row">
          <label className="pe__field">
            <span>Background</span>
            <SwatchPicker
              value={part.pcbColor}
              fallback="#0f5a2e"
              used={collectUsedColors(part)}
              onChange={(c) => patch({ pcbColor: c })}
              ariaLabel="PCB / board background colour"
            />
          </label>
        </div>
        {part.shape?.kind !== 'polygon' && (
          <SliderField
            label="Corner radius"
            value={part.shape?.cornerRadius ?? 0.04}
            min={0}
            max={0.5}
            step={0.01}
            onChange={(v) => patch({ shape: { kind: 'rect', cornerRadius: v } })}
          />
        )}
        <label className="pe__field">
          <span>Onboard LED pin</span>
          <select value={part.ledLabel ?? ''} onChange={(e) => patch({ ledLabel: e.target.value || undefined })}>
            <option value="">None</option>
            {!props.names.includes('LED') && <option value="LED">LED</option>}
            {props.names.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </section>
    </>
  )
}

/** The part's identity / catalogue metadata — placed at the TOP of the panel. */
function DetailsSection({
  part,
  patch,
  propRows,
  setProps,
  detailsOpen,
  setDetailsOpen,
  fileId
}: {
  part: PartDefinition
  patch: (p: Partial<PartDefinition>) => void
  propRows: [string, string][]
  setProps: (rows: [string, string][]) => void
  detailsOpen: boolean
  setDetailsOpen: (b: boolean) => void
  fileId: string
}): JSX.Element {
  return (
    <section className="pe__section">
      <h3 className="pe__h">
        Details
        <button type="button" className="pe__add" onClick={() => setDetailsOpen(!detailsOpen)}>
          {detailsOpen ? 'Hide' : 'Show'}
        </button>
      </h3>
      <label className="pe__field">
        <span>Name</span>
        <input
          type="text"
          value={part.name}
          onChange={(e) => patch({ name: e.target.value, id: sanitisePartId(e.target.value) || part.id })}
          placeholder="VL53L0X ToF"
        />
      </label>
      <p className="pe__hint">
        Saves as <code>{fileId || '—'}/parts.yml</code>
      </p>
      {detailsOpen && <DetailsFields part={part} patch={patch} propRows={propRows} setProps={setProps} />}
    </section>
  )
}

/** A labelled slider paired with a number box, so values can be set precisely. */
function SliderField({
  label,
  value,
  min,
  max,
  step,
  onChange
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
}): JSX.Element {
  const set = (raw: number): void => {
    const v = Number.isFinite(raw) ? Math.min(max, Math.max(min, raw)) : min
    onChange(v)
  }
  return (
    <label className="pe__field">
      <span>{label}</span>
      <div className="pe__slider">
        <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => set(Number(e.target.value))} />
        <input
          className="pe__slider-num"
          type="number"
          min={min}
          max={max}
          step={step}
          value={Number.isFinite(value) ? value : min}
          onChange={(e) => set(Number(e.target.value))}
        />
      </div>
    </label>
  )
}

/** A native colour input plus a quick-pick grid of the colours already used in
 *  the part — shared by every colour well in the Properties panel. */
function SwatchPicker({
  value,
  fallback,
  used,
  onChange,
  ariaLabel
}: {
  value?: string
  fallback: string
  used: string[]
  onChange: (c: string) => void
  ariaLabel?: string
}): JSX.Element {
  return (
    <div className="pe__swatchpick">
      <input
        type="color"
        value={/^#[0-9a-f]{6}$/i.test(value ?? '') ? (value as string) : fallback}
        onChange={(e) => onChange(e.target.value)}
        aria-label={ariaLabel}
      />
      {used.length > 0 && (
        <div className="pe__swatches">
          {used.map((c) => (
            <button
              key={c}
              type="button"
              className="pe__swatch"
              style={{ background: c }}
              title={c}
              aria-label={`Use ${c}`}
              onClick={() => onChange(c)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/** Text-alignment icon (rows of lines anchored left / centred / right). */
function alignIcon(a: TextAlign): JSX.Element {
  const lines =
    a === 'left'
      ? ['M2 4h12', 'M2 8h7', 'M2 12h10']
      : a === 'right'
        ? ['M2 4h12', 'M7 8h7', 'M4 12h10']
        : ['M2 4h12', 'M4.5 8h7', 'M3 12h10']
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <g stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
        {lines.map((d, k) => (
          <path key={k} d={d} />
        ))}
      </g>
    </svg>
  )
}

/** Inline text-style controls (bold / italic / underline, alignment, optional
 *  wrap) shared by the free-label and shape-label inspectors. `onChange` is
 *  called with ONLY the field that changed. */
function TextStyleRow({
  bold,
  italic,
  underline,
  align,
  wrap,
  showWrap,
  onChange
}: {
  bold?: boolean
  italic?: boolean
  underline?: boolean
  align?: TextAlign
  wrap?: boolean
  showWrap?: boolean
  onChange: (p: { bold?: boolean; italic?: boolean; underline?: boolean; align?: TextAlign; wrap?: boolean }) => void
}): JSX.Element {
  const a: TextAlign = align ?? 'center'
  const btn = (
    active: boolean,
    label: JSX.Element | string,
    title: string,
    on: () => void,
    style?: CSSProperties
  ): JSX.Element => (
    <button
      type="button"
      className={`pe__tbtn${active ? ' is-active' : ''}`}
      title={title}
      aria-pressed={active}
      onClick={on}
      style={style}
    >
      {label}
    </button>
  )
  return (
    <label className="pe__field">
      <span>Text style</span>
      <div className="pe__tbtns">
        {btn(!!bold, 'B', 'Bold', () => onChange({ bold: !bold }), { fontWeight: 700 })}
        {btn(!!italic, 'I', 'Italic', () => onChange({ italic: !italic }), { fontStyle: 'italic' })}
        {btn(!!underline, 'U', 'Underline', () => onChange({ underline: !underline }), { textDecoration: 'underline' })}
        <span className="pe__tsep" />
        {btn(a === 'left', alignIcon('left'), 'Align left', () => onChange({ align: 'left' }))}
        {btn(a === 'center', alignIcon('center'), 'Align centre', () => onChange({ align: 'center' }))}
        {btn(a === 'right', alignIcon('right'), 'Align right', () => onChange({ align: 'right' }))}
        {showWrap && (
          <>
            <span className="pe__tsep" />
            {btn(!!wrap, '↵', 'Wrap text to the shape', () => onChange({ wrap: !wrap }))}
          </>
        )}
      </div>
    </label>
  )
}

/** The editable fields for whatever is selected on the canvas. */
function SelectionInspector({
  part,
  selection,
  setPart,
  patch,
  setImageLayer,
  lockImageAspect,
  onToggleLockAspect,
  deleteSelection
}: InspectorProps): JSX.Element {
  if (!selection) {
    return (
      <section className="pe__section">
        <h3 className="pe__h">Inspector</h3>
        <p className="pe__hint">
          Use a tool to add a <strong>pin</strong>, <strong>hole</strong> or <strong>label</strong>, or pick
          <strong> Select</strong> and click an object on the canvas to edit it here.
        </p>
      </section>
    )
  }

  const num = (label: string, value: number, on: (v: number) => void, step = 0.01): JSX.Element => (
    <label className="pe__num">
      <span>{label}</span>
      <input type="number" step={step} value={Number.isFinite(value) ? value : 0} onChange={(e) => on(Number(e.target.value))} />
    </label>
  )

  // A size field shown in millimetres: `norm` is a 0..1 fraction of `dimMm` (the
  // board's real dimension). Edits convert mm back to the stored fraction. With no
  // board dimension it degrades to the raw fraction so nothing breaks.
  const mmSize = (label: string, norm: number, dimMm: number | undefined, onNorm: (n: number) => void): JSX.Element =>
    dimMm && dimMm > 0
      ? num(`${label} (mm)`, Math.round(norm * dimMm * 10) / 10, (mm) => onNorm(mm / dimMm), 0.5)
      : num(label, norm, onNorm)

  let body: JSX.Element = <></>
  let title = 'Inspector'

  if (selection.type === 'pin') {
    const pin = part.headers[selection.hi]?.pins[selection.pi]
    if (pin) {
      title = `Pin: ${pin.name || '—'}`
      const updatePin = (p: Partial<PartPin>): void =>
        setPart((d) => ({
          ...d,
          headers: d.headers.map((h, i) =>
            i === selection.hi ? { ...h, pins: h.pins.map((pp, j) => (j === selection.pi ? { ...pp, ...p } : pp)) } : h
          )
        }))
      const toggleCap = (c: PartPinCapability): void => {
        const has = pin.capabilities?.includes(c)
        updatePin({ capabilities: has ? (pin.capabilities ?? []).filter((x) => x !== c) : [...(pin.capabilities ?? []), c] })
      }
      const setSignal = (cap: keyof PartPinSignals, value: string): void => {
        const signals: Record<string, string> = { ...(pin.signals ?? {}) }
        if (value) signals[cap] = value
        else delete signals[cap]
        updatePin({ signals: Object.keys(signals).length ? (signals as PartPinSignals) : undefined })
      }
      const setBus = (cap: keyof PartPinBuses, value: number | undefined): void => {
        const buses: Record<string, number> = { ...(pin.buses ?? {}) }
        if (value != null && Number.isFinite(value)) buses[cap] = value
        else delete buses[cap]
        updatePin({ buses: Object.keys(buses).length ? (buses as PartPinBuses) : undefined })
      }
      body = (
        <>
          <div className="pe__row">
            <label className="pe__field">
              <span>Name</span>
              <input type="text" value={pin.name} onChange={(e) => updatePin({ name: e.target.value })} />
            </label>
            <label className="pe__field">
              <span>Type</span>
              <select value={pin.type} onChange={(e) => updatePin({ type: e.target.value as PartPinType })}>
                {PIN_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {PIN_TYPE_LABEL[t]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="pe__row">
            <label className="pe__field">
              <span>Board pin #</span>
              <input type="number" value={pin.number ?? ''} onChange={(e) => updatePin({ number: e.target.value === '' ? undefined : Number(e.target.value) })} />
            </label>
            {pin.type === 'io' && (
              <label className="pe__field">
                <span>GPIO</span>
                <input type="number" value={pin.gpio ?? ''} onChange={(e) => updatePin({ gpio: e.target.value === '' ? undefined : Number(e.target.value) })} />
              </label>
            )}
          </div>
          {pin.type === 'io' && (
            <div className="pe__caps">
              {CAPABILITIES.map((c) => (
                <label key={c} className={`pe__cap${pin.capabilities?.includes(c) ? ' is-on' : ''}`}>
                  <input type="checkbox" checked={!!pin.capabilities?.includes(c)} onChange={() => toggleCap(c)} />
                  {CAPABILITY_LABEL[c]}
                </label>
              ))}
            </div>
          )}
          {/* Bus/channel number + signal per ticked capability — ONE ROW EACH so
              the labels + dropdowns don't clash (I2C0 SDA, SPI1 SCK, ADC2, PWM A). */}
          {pin.type === 'io' &&
            PIN_CAP_CONFIG.some((o) => pin.capabilities?.includes(o.cap)) && (
              <div className="pe__signals">
                {PIN_CAP_CONFIG.filter((o) => pin.capabilities?.includes(o.cap)).map((o) => (
                  <div key={o.cap} className="pe__row">
                    {o.bus && (
                      <label className="pe__field">
                        <span>
                          {o.label} {o.bus}
                        </span>
                        <input
                          type="number"
                          value={pin.buses?.[o.cap as keyof PartPinBuses] ?? ''}
                          onChange={(e) =>
                            setBus(o.cap as keyof PartPinBuses, e.target.value === '' ? undefined : Number(e.target.value))
                          }
                        />
                      </label>
                    )}
                    {o.signals && (
                      <label className="pe__field">
                        <span>{o.label} signal</span>
                        <select
                          value={pin.signals?.[o.cap as keyof PartPinSignals] ?? ''}
                          onChange={(e) => setSignal(o.cap as keyof PartPinSignals, e.target.value)}
                        >
                          <option value="">—</option>
                          {o.signals.map((v) => (
                            <option key={v} value={v}>
                              {v}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                  </div>
                ))}
              </div>
            )}
          <label className="pe__field">
            <span>Pad shape</span>
            <select
              value={pinShapeOf(pin)}
              onChange={(e) => {
                const shape = e.target.value as PartPinShape
                // Keep the legacy `castellated` flag consistent with the shape.
                updatePin({ shape, castellated: shape === 'castellated' ? true : undefined })
              }}
            >
              {PIN_SHAPES.map((s) => (
                <option key={s} value={s}>
                  {PIN_SHAPE_LABEL[s]}
                </option>
              ))}
            </select>
          </label>
          {/* Rotation applies to EVERY pin — it turns the silk label (and the
              half-hole on castellated pads). Shown for all shapes so the label can
              be aimed any of the four ways; the degree readout confirms it saved. */}
          {(() => {
            // Default to the SAME nearest-border direction the label is drawn with
            // (pinOutwardDir uses x AND y), so the readout + the +90/+180 base match
            // what's on the canvas for top/bottom-edge pins too.
            const dir = pinOutwardDir(pin.rotation, pin.x ?? 0.5, pin.y ?? 0.5)
            const rot = pin.rotation ?? { right: 0, bottom: 90, left: 180, top: 270 }[dir]
            return (
              <div className="pe__pinrot">
                <span>Rotation</span>
                <button
                  type="button"
                  className="pe__iconbtn"
                  title="Rotate 90° (turns the label; the half-hole on castellated pads)"
                  aria-label="Rotate pin"
                  onClick={() => updatePin({ rotation: (rot + 90) % 360 })}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M20 11a8 8 0 1 0-2.3 5.6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    <path d="M20 4v5h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                <button
                  type="button"
                  className="pe__iconbtn"
                  title="Flip 180°"
                  aria-label="Flip pin"
                  onClick={() => updatePin({ rotation: (rot + 180) % 360 })}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M12 3v18" stroke="currentColor" strokeWidth="1.6" strokeDasharray="2 2" />
                    <path d="M8 8l-4 4 4 4M16 8l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                <span className="pe__pinrot-deg">{rot}°</span>
              </div>
            )
          })()}
          <div className="pe__row">
            {num('x', pin.x ?? 0, (v) => updatePin({ x: v }))}
            {num('y', pin.y ?? 0, (v) => updatePin({ y: v }))}
          </div>
          {/* Manual label placement: the label is dragged on the canvas; offer a
              reset once it's been moved off its default spot. */}
          {pin.labelOffset && (
            <button type="button" className="pe__btn pe__btn--sm" onClick={() => updatePin({ labelOffset: undefined })} title="Move this pin's label back to its default position">
              Reset label position
            </button>
          )}
          <p className="pe__hint pe__hint--muted">Drag a pin&apos;s label on the canvas to place it by hand.</p>
        </>
      )
    }
  } else if (selection.type === 'hole') {
    const hole = (part.mountingHoles ?? [])[selection.index]
    if (hole) {
      title = 'Mounting hole'
      const upd = (p: Partial<MountingHole>): void =>
        patch({ mountingHoles: (part.mountingHoles ?? []).map((h, i) => (i === selection.index ? { ...h, ...p } : h)) })
      body = (
        <div className="pe__row">
          {num('x', hole.x, (v) => upd({ x: v }))}
          {num('y', hole.y, (v) => upd({ y: v }))}
          {num('⌀mm', hole.diameter, (v) => upd({ diameter: v }), 0.1)}
        </div>
      )
    }
  } else if (selection.type === 'button') {
    const btn = (part.buttons ?? [])[selection.index]
    if (btn) {
      title = 'Button'
      const upd = (p: Partial<PartButton>): void =>
        patch({ buttons: (part.buttons ?? []).map((b, i) => (i === selection.index ? { ...b, ...p } : b)) })
      body = (
        <>
          <label className="pe__field">
            <span>Label</span>
            <input type="text" value={btn.label} onChange={(e) => upd({ label: e.target.value })} placeholder="e.g. BOOT" />
          </label>
          <div className="pe__row">
            {num('x', btn.x, (v) => upd({ x: v }))}
            {num('y', btn.y, (v) => upd({ y: v }))}
          </div>
        </>
      )
    }
  } else if (selection.type === 'led') {
    const led = (part.onboardLeds ?? [])[selection.index]
    if (led) {
      title =
        led.kind === 'rgb' ? 'Onboard RGB LED' : led.kind === 'neopixel' ? 'Onboard NeoPixel' : 'Onboard LED'
      const upd = (p: Partial<OnboardLed>): void =>
        patch({ onboardLeds: (part.onboardLeds ?? []).map((l, i) => (i === selection.index ? { ...l, ...p } : l)) })
      const updRgb = (ch: 'r' | 'g' | 'b', v: number | undefined): void =>
        upd({ rgb: { ...(led.rgb ?? {}), [ch]: v } })
      const gpioField = (label: string, value: number | undefined, on: (v: number | undefined) => void, ph?: string): JSX.Element => (
        <label className="pe__field">
          <span>{label}</span>
          <input
            type="number"
            value={value ?? ''}
            placeholder={ph}
            onChange={(e) => on(e.target.value === '' ? undefined : Number(e.target.value))}
          />
        </label>
      )
      body = (
        <>
          <div className="pe__row">
            <label className="pe__field">
              <span>Type</span>
              <select value={led.kind} onChange={(e) => upd({ kind: e.target.value as OnboardLed['kind'] })}>
                <option value="single">LED</option>
                <option value="rgb">RGB</option>
                <option value="neopixel">NeoPixel</option>
              </select>
            </label>
            <label className="pe__field">
              <span>Label</span>
              <input
                type="text"
                value={led.label ?? ''}
                onChange={(e) => upd({ label: e.target.value || undefined })}
                placeholder={led.kind === 'rgb' ? 'RGB' : led.kind === 'neopixel' ? 'NeoPixel' : 'LED'}
              />
            </label>
          </div>
          {led.kind === 'single' && (
            <div className="pe__row">
              {gpioField('GPIO', led.gpio, (v) => upd({ gpio: v }))}
              <label className="pe__field">
                <span>Colour</span>
                <input type="color" value={led.color ?? '#39d353'} onChange={(e) => upd({ color: e.target.value })} />
              </label>
            </div>
          )}
          {led.kind === 'rgb' && (
            <div className="pe__row">
              {(['r', 'g', 'b'] as const).map((ch) => (
                <label key={ch} className="pe__field">
                  <span>{ch.toUpperCase()} GPIO</span>
                  <input
                    type="number"
                    value={led.rgb?.[ch] ?? ''}
                    onChange={(e) => updRgb(ch, e.target.value === '' ? undefined : Number(e.target.value))}
                  />
                </label>
              ))}
            </div>
          )}
          {led.kind === 'neopixel' && (
            <div className="pe__row">
              {gpioField('Data GPIO', led.gpio, (v) => upd({ gpio: v }))}
              {gpioField('Power GPIO', led.power, (v) => upd({ power: v }), 'optional')}
            </div>
          )}
          <div className="pe__row">
            {num('x', led.x, (v) => upd({ x: v }))}
            {num('y', led.y, (v) => upd({ y: v }))}
          </div>
        </>
      )
    }
  } else if (selection.type === 'connector') {
    const conn = (part.connectors ?? [])[selection.index]
    if (conn) {
      title = conn.kind === 'qwiic' ? 'QWIIC / STEMMA QT' : 'JST connector'
      const upd = (p: Partial<PartConnector>): void =>
        patch({ connectors: (part.connectors ?? []).map((c, i) => (i === selection.index ? { ...c, ...p } : c)) })
      const updPin = (pi: number, p: Partial<PartPin>): void =>
        upd({ pins: conn.pins.map((pp, j) => (j === pi ? { ...pp, ...p } : pp)) })
      const updBus = (pi: number, v: number | undefined): void => {
        const buses: Record<string, number> = { ...(conn.pins[pi].buses ?? {}) }
        if (v != null && Number.isFinite(v)) buses.i2c = v
        else delete buses.i2c
        updPin(pi, { buses: Object.keys(buses).length ? (buses as PartPin['buses']) : undefined })
      }
      body = (
        <>
          <label className="pe__field">
            <span>Label</span>
            <input
              type="text"
              value={conn.label ?? ''}
              onChange={(e) => upd({ label: e.target.value || undefined })}
              placeholder={conn.kind === 'qwiic' ? 'QWIIC' : 'JST'}
            />
          </label>
          {/* Each contact is a full pin — assign GP## (+ I2C bus for SDA/SCL). */}
          {conn.pins.map((p, pi) => (
            <div key={pi} className="pe__conn-pin">
              <div className="pe__row">
                <label className="pe__field">
                  <span>Pin {pi + 1}</span>
                  <input type="text" value={p.name} onChange={(e) => updPin(pi, { name: e.target.value })} />
                </label>
                <label className="pe__field">
                  <span>Type</span>
                  <select value={p.type} onChange={(e) => updPin(pi, { type: e.target.value as PartPinType })}>
                    {PIN_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {PIN_TYPE_LABEL[t]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {p.type === 'io' && (
                <div className="pe__row">
                  <label className="pe__field">
                    <span>GPIO</span>
                    <input
                      type="number"
                      value={p.gpio ?? ''}
                      onChange={(e) => updPin(pi, { gpio: e.target.value === '' ? undefined : Number(e.target.value) })}
                    />
                  </label>
                  {p.capabilities?.includes('i2c') && (
                    <label className="pe__field">
                      <span>I2C bus</span>
                      <input
                        type="number"
                        value={p.buses?.i2c ?? ''}
                        onChange={(e) => updBus(pi, e.target.value === '' ? undefined : Number(e.target.value))}
                      />
                    </label>
                  )}
                </div>
              )}
            </div>
          ))}
          <div className="pe__row">
            {num('x', conn.x, (v) => upd({ x: v }))}
            {num('y', conn.y, (v) => upd({ y: v }))}
          </div>
        </>
      )
    }
  } else if (selection.type === 'shape' || selection.type === 'shape-vertex') {
    const si = selection.index
    const shp = (part.shapes ?? [])[si]
    if (shp) {
      title = `Component (${shp.kind})`
      const upd = (p: Partial<ComponentShape>): void =>
        patch({ shapes: (part.shapes ?? []).map((s, i) => (i === si ? { ...s, ...p } : s)) })
      const used = collectUsedColors(part)
      const colour = (val: string | undefined, fallback: string, on: (v: string) => void): JSX.Element => (
        <SwatchPicker value={val} fallback={fallback} used={used} onChange={on} />
      )
      body = (
        <>
          <label className="pe__field">
            <span>Text</span>
            <textarea
              className="pe__textarea"
              value={shp.label ?? ''}
              onChange={(e) => upd({ label: e.target.value })}
              placeholder="(optional — Enter for a new line)"
              rows={2}
            />
          </label>
          <div className="pe__row">
            <label className="pe__field">
              <span>Fill</span>
              {colour(shp.fill, '#1c2227', (v) => upd({ fill: v }))}
            </label>
            <label className="pe__field">
              <span>Outline</span>
              {colour(shp.stroke, '#8a8f96', (v) => upd({ stroke: v }))}
            </label>
            <label className="pe__field">
              <span>Width</span>
              <input type="number" step="0.5" min="0" value={shp.strokeWidth ?? 1} onChange={(e) => upd({ strokeWidth: Number(e.target.value) })} />
            </label>
          </div>
          <div className="pe__row">
            {num('x', shp.x, (v) => upd({ x: v }))}
            {num('y', shp.y, (v) => upd({ y: v }))}
            {/* Size shown in mm (a fraction of the board's real dimensions) so equal
                w/h is a true square; falls back to the raw fraction with no board size. */}
            {shp.kind === 'rect' && mmSize('w', shp.w ?? 0.2, part.dimensions?.width, (v) => upd({ w: v }))}
            {shp.kind === 'rect' && mmSize('h', shp.h ?? 0.15, part.dimensions?.height, (v) => upd({ h: v }))}
            {shp.kind === 'circle' && mmSize('r', shp.r ?? 0.08, part.dimensions?.width, (v) => upd({ r: v }))}
          </div>
          {shp.kind === 'rect' && (
            <SliderField
              label="Corner radius"
              value={shp.cornerRadius ?? 3}
              min={0}
              max={40}
              step={1}
              onChange={(v) => upd({ cornerRadius: v })}
            />
          )}
          <div className="pe__row">
            <SliderField
              label="Label size"
              value={shp.labelFontSize ?? 10}
              min={4}
              max={48}
              step={1}
              onChange={(v) => upd({ labelFontSize: v })}
            />
            <label className="pe__field">
              <span>Label colour</span>
              {colour(shp.labelColor, '#cfd6dd', (v) => upd({ labelColor: v }))}
            </label>
          </div>
          <TextStyleRow
            bold={shp.labelBold}
            italic={shp.labelItalic}
            underline={shp.labelUnderline}
            align={shp.labelAlign}
            wrap={shp.labelWrap}
            showWrap
            onChange={(p) => {
              const m: Partial<ComponentShape> = {}
              if ('bold' in p) m.labelBold = p.bold
              if ('italic' in p) m.labelItalic = p.italic
              if ('underline' in p) m.labelUnderline = p.underline
              if ('align' in p) m.labelAlign = p.align
              if ('wrap' in p) m.labelWrap = p.wrap
              upd(m)
            }}
          />
          {shp.kind === 'polygon' && (
            <p className="pe__hint">Drag the polygon vertices on the canvas to reshape it.</p>
          )}
        </>
      )
    }
  } else if (selection.type === 'label') {
    const lbl = (part.labels ?? [])[selection.index]
    if (lbl) {
      title = 'Label'
      const upd = (p: Partial<PartLabel>): void =>
        patch({ labels: (part.labels ?? []).map((l, i) => (i === selection.index ? { ...l, ...p } : l)) })
      body = (
        <>
          <label className="pe__field">
            <span>Text</span>
            <input type="text" value={lbl.text} onChange={(e) => upd({ text: e.target.value })} />
          </label>
          <div className="pe__row">
            {num('x', lbl.x, (v) => upd({ x: v }))}
            {num('y', lbl.y, (v) => upd({ y: v }))}
            {num('size', lbl.fontSize ?? 12, (v) => upd({ fontSize: v }), 1)}
            <label className="pe__field">
              <span>Colour</span>
              <SwatchPicker
                value={lbl.color}
                fallback="#e9edf1"
                used={collectUsedColors(part)}
                onChange={(c) => upd({ color: c })}
                ariaLabel="Label colour"
              />
            </label>
          </div>
          <TextStyleRow
            bold={lbl.bold}
            italic={lbl.italic}
            underline={lbl.underline}
            align={lbl.align}
            onChange={(p) => {
              const m: Partial<PartLabel> = {}
              if ('bold' in p) m.bold = p.bold
              if ('italic' in p) m.italic = p.italic
              if ('underline' in p) m.underline = p.underline
              if ('align' in p) m.align = p.align
              upd(m)
            }}
          />
        </>
      )
    }
  } else if (selection.type === 'vertex') {
    const v = (part.polygon ?? [])[selection.index]
    if (v) {
      title = `Vertex ${selection.index + 1}`
      const upd = (p: Partial<{ x: number; y: number }>): void =>
        patch({ polygon: (part.polygon ?? []).map((pt, i) => (i === selection.index ? { ...pt, ...p } : pt)) })
      body = (
        <div className="pe__row">
          {num('x', v.x, (val) => upd({ x: val }))}
          {num('y', v.y, (val) => upd({ y: val }))}
        </div>
      )
    }
  } else if (selection.type === 'image') {
    title = 'Image layer'
    const layer = part.imageLayer ?? { x: 0, y: 0, w: 1, h: 1 }
    body = (
      <>
        <div className="pe__row">
          {num('x', layer.x, (v) => setImageLayer({ x: v }))}
          {num('y', layer.y, (v) => setImageLayer({ y: v }))}
        </div>
        <div className="pe__row">
          {num('w', layer.w, (v) => setImageLayer({ w: v }))}
          {num('h', layer.h, (v) => setImageLayer({ h: v }))}
        </div>
        <SliderField label="Opacity" value={layer.opacity ?? 1} min={0.1} max={1} step={0.05} onChange={(v) => setImageLayer({ opacity: v })} />
        <button
          type="button"
          className={`pe__togglebtn${lockImageAspect ? ' is-active' : ''}`}
          onClick={onToggleLockAspect}
          aria-pressed={lockImageAspect}
          title="Keep the image at its native aspect ratio while resizing"
        >
          <span className="pe__togglebtn-dot" aria-hidden="true" />
          Lock aspect ratio
        </button>
      </>
    )
  }

  return (
    <section className="pe__section pe__section--sel">
      <h3 className="pe__h">
        {title}
        <button type="button" className="pe__add pe__add--danger" onClick={deleteSelection} title="Delete the selected object">
          Delete
        </button>
      </h3>
      {body}
    </section>
  )
}

/** The catalogue/identity fields (collapsed by default). */
function DetailsFields({
  part,
  patch,
  propRows,
  setProps
}: {
  part: PartDefinition
  patch: (p: Partial<PartDefinition>) => void
  propRows: [string, string][]
  setProps: (rows: [string, string][]) => void
}): JSX.Element {
  return (
    <>
      <label className="pe__field">
        <span>Description</span>
        <input type="text" value={part.description ?? ''} onChange={(e) => patch({ description: e.target.value })} placeholder="Time-of-flight distance sensor" />
      </label>
      <div className="pe__row">
        <label className="pe__field">
          <span>Manufacturer</span>
          <input type="text" value={part.manufacturer ?? ''} onChange={(e) => patch({ manufacturer: e.target.value })} placeholder="Pimoroni" />
        </label>
        <label className="pe__field">
          <span>Family</span>
          <input
            type="text"
            list="pe-family-options"
            value={part.family ?? ''}
            onChange={(e) => patch({ family: e.target.value })}
            placeholder="Sensor"
          />
          <datalist id="pe-family-options">
            <option value="Microcontroller" />
            <option value="Sensor" />
            <option value="Motor Driver" />
            <option value="Display" />
            <option value="Breakout" />
            <option value="Connector" />
          </datalist>
        </label>
      </div>
      <label className="pe__check pe__check--board">
        <input
          type="checkbox"
          checked={(part.family ?? '').trim().toLowerCase() === 'microcontroller'}
          onChange={(e) => patch({ family: e.target.checked ? 'Microcontroller' : '' })}
        />
        <span>
          This part is a <strong>microcontroller board</strong> — it appears in the Board Viewer&rsquo;s board selector.
        </span>
      </label>
      <label className="pe__field">
        <span>Tags (comma-separated)</span>
        <input
          type="text"
          value={(part.tags ?? []).join(', ')}
          onChange={(e) => patch({ tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) })}
          placeholder="i2c, distance, tof"
        />
      </label>
      <div className="pe__row">
        <label className="pe__field">
          <span>Package</span>
          <select value={part.package ?? 'THT'} onChange={(e) => patch({ package: e.target.value as PartDefinition['package'] })}>
            {PACKAGES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <label className="pe__field">
          <span>Pin spacing (mm)</span>
          <input type="number" step="0.01" value={part.pinSpacing ?? 2.54} onChange={(e) => patch({ pinSpacing: Number(e.target.value) || 2.54 })} />
        </label>
      </div>
      <div className="pe__row">
        <label className="pe__field">
          <span>Voltage</span>
          <input type="text" value={part.voltage ?? ''} onChange={(e) => patch({ voltage: e.target.value })} placeholder="3.3V" />
        </label>
        <label className="pe__field">
          <span>Part #</span>
          <input type="text" value={part.partNumber ?? ''} onChange={(e) => patch({ partNumber: e.target.value })} placeholder="SC0918" />
        </label>
        <label className="pe__field">
          <span>Version</span>
          <input type="text" value={part.version ?? ''} onChange={(e) => patch({ version: e.target.value })} placeholder="1.0.0" />
        </label>
      </div>

      <h4 className="pe__subh">Code library</h4>
      <label className="pe__field">
        <span>Module (import name)</span>
        <input
          type="text"
          value={part.library?.module ?? ''}
          onChange={(e) => patch({ library: { ...part.library, module: e.target.value } })}
          placeholder="vl53l0x"
        />
      </label>
      <label className="pe__field">
        <span>Library URL (mip / git)</span>
        <input
          type="text"
          value={part.library?.url ?? ''}
          onChange={(e) => patch({ library: { ...part.library, url: e.target.value } })}
          placeholder="github:org/repo or https://…"
        />
      </label>
      <label className="pe__field">
        <span>Docs / README URL</span>
        <input
          type="text"
          value={part.library?.docs ?? ''}
          onChange={(e) => patch({ library: { ...part.library, docs: e.target.value } })}
          placeholder="https://…"
        />
      </label>

      <h4 className="pe__subh">
        Properties
        <button type="button" className="pe__add" onClick={() => setProps([...propRows, ['', '']])}>
          + Add
        </button>
      </h4>
      {propRows.map(([k, v], i) => (
        <div className="pe__row pe__subitem" key={i}>
          <input className="pe__grow" type="text" value={k} placeholder="key" onChange={(e) => setProps(propRows.map((p, j) => (j === i ? [e.target.value, p[1]] : p)))} />
          <input className="pe__grow" type="text" value={v} placeholder="value" onChange={(e) => setProps(propRows.map((p, j) => (j === i ? [p[0], e.target.value] : p)))} />
          <button type="button" className="pe__icon pe__icon--danger" onClick={() => setProps(propRows.filter((_, j) => j !== i))} title="Delete property">
            ✕
          </button>
        </div>
      ))}
    </>
  )
}

// --- Schematic view panels --------------------------------------------------

function SchematicPanels({
  part,
  patch
}: {
  part: PartDefinition
  patch: (p: Partial<PartDefinition>) => void
}): JSX.Element {
  // The pad ↔ pin table: each physical pin maps to a schematic symbol side.
  // Addressed by ROW INDEX so same-named pins (e.g. multiple GND) edit alone.
  const rows = part.schematic?.pins?.length
    ? part.schematic.pins.map((sp) => ({ name: sp.pin, side: sp.side, order: sp.order }))
    : resolvedPins(part).map((rp) => ({ name: rp.pin.name, side: rp.edge, order: rp.pi }))

  const setMapping = (index: number, p: Partial<{ side: PartHeader['edge']; order: number }>): void => {
    const next = rows.map((row, i) => (i === index ? { ...row, ...p } : row))
    patch({
      schematic: {
        ...(part.schematic?.aspect !== undefined ? { aspect: part.schematic.aspect } : {}),
        pins: next.map((r) => ({ pin: r.name, side: r.side, order: r.order }))
      }
    })
  }

  return (
    <>
      <section className="pe__section">
        <h3 className="pe__h">Schematic</h3>
        <p className="pe__hint">
          Define the pins in the Breadboard view, then place each on a side of the symbol. Connect pads ↔ pins
          with the table below; the symbol updates live on the right.
        </p>
      </section>
      <section className="pe__section">
        <h3 className="pe__h">Pad ↔ pin table</h3>
        {rows.length === 0 && <p className="pe__hint">No pins yet — add some in the Breadboard view.</p>}
        {rows.map((row, i) => (
          <div className="pe__row pe__subitem" key={i}>
            <span className="pe__grow pe__padname">{row.name}</span>
            <label className="pe__num">
              <span>side</span>
              <select value={row.side} onChange={(e) => setMapping(i, { side: e.target.value as PartHeader['edge'] })}>
                {PART_EDGES.map((edge) => (
                  <option key={edge} value={edge}>
                    {edge}
                  </option>
                ))}
              </select>
            </label>
            <label className="pe__num">
              <span>order</span>
              <input type="number" value={row.order} onChange={(e) => setMapping(i, { order: Number(e.target.value) || 0 })} />
            </label>
          </div>
        ))}
      </section>
    </>
  )
}
