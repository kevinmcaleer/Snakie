import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { PartSchematicView } from './PartSchematicView'
import {
  PartCanvas,
  DEFAULT_LAYERS,
  type CanvasSelection,
  type CanvasTool,
  type LayerVisibility
} from './PartCanvas'
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
  normalisePart,
  pinNames,
  pinShapeOf,
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
  PartDefinition,
  PartHeader,
  PartLabel,
  PartLibrary,
  PartPin,
  PartPinCapability,
  PartPinShape,
  PartPinType
} from '../../../shared/part'
import type { PartsWriteResult } from '../../../preload/index.d'
import './PartEditor.css'

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

export function PartEditor({
  libraryId,
  initial,
  existingParts,
  libraries,
  onClose,
  onSaved
}: PartEditorProps): JSX.Element {
  // Seed with every pin given an absolute x/y and legacy feature chips migrated
  // into editable component shapes (see withPinPositions / withShapesFromFeatures).
  const [part, setPart] = useState<PartDefinition>(() =>
    withShapesFromFeatures(withPinPositions(initial ?? blankPart()))
  )
  const [libId, setLibId] = useState<string>(libraryId)
  const [openedId, setOpenedId] = useState<string | null>(initial?.id ?? null)
  // The library the part was opened/last-saved from — so the collision guard only
  // stays silent when saving back to the SAME library with the same id.
  const [openedLibId, setOpenedLibId] = useState<string>(libraryId)
  const [propRows, setPropRows] = useState<[string, string][]>(() =>
    Object.entries(initial?.properties ?? {})
  )
  const [view, setView] = useState<'breadboard' | 'schematic'>('breadboard')
  const [visible, setVisible] = useState<LayerVisibility>(DEFAULT_LAYERS)
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
  const [detailsOpen, setDetailsOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

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
    if (sel.type === 'pin') {
      setPart((d) => ({
        ...d,
        headers: d.headers
          .map((h, i) => (i === sel.hi ? { ...h, pins: h.pins.filter((_, j) => j !== sel.pi) } : h))
          .filter((h) => h.pins.length > 0)
      }))
    } else if (sel.type === 'hole') {
      patch({ mountingHoles: (part.mountingHoles ?? []).filter((_, i) => i !== sel.index) })
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

  // Delete / Backspace removes the selected object — but not while typing in a
  // field (so editing a name/number isn't hijacked).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      if (!selection) return
      const el = document.activeElement as HTMLElement | null
      const tag = el?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return
      e.preventDefault()
      deleteSelection()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // --- persistence ----------------------------------------------------------
  const newPart = (): void => {
    setPart(withShapesFromFeatures(withPinPositions(blankPart())))
    setPropRows([])
    setOpenedId(null)
    setSelection(null)
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
    const payload: PartDefinition = { ...clean, imageData: part.imageData }
    try {
      const res: PartsWriteResult = await window.api.parts.savePart(libId, payload)
      if (res?.ok) {
        setOpenedId(clean.id)
        setOpenedLibId(res.libraryId ?? libId)
        setStatus({ kind: 'ok', text: `Saved "${clean.name}" to ${res.libraryId ?? libId}.` })
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
                <ShapesMenu tool={tool} setTool={setTool} />
                <button type="button" className={`pe__iconbtn${tool === 'text' ? ' is-active' : ''}`} onClick={() => setTool('text')} title="Add a text label" aria-label="Text">
                  {ICON.text}
                </button>
              </div>
              <div className="pe__canvas-stage">
                <PartCanvas
                  part={part}
                  visible={visible}
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
                part={part}
                visible={visible}
                setVisible={setVisible}
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
  tool: CanvasTool
  setTool: (t: CanvasTool) => void
  selection: CanvasSelection
  setSelection: (s: CanvasSelection) => void
  onDeleteSelected: () => void
  fileInputRef: React.RefObject<HTMLInputElement>
  onPickImage: (e: React.ChangeEvent<HTMLInputElement>) => void
  patch: (p: Partial<PartDefinition>) => void
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
  tool,
  setTool,
  selection,
  setSelection,
  onDeleteSelected,
  fileInputRef,
  onPickImage,
  patch
}: LayersPanelProps): JSX.Element {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const pins = resolvedPins(part)
  const holes = part.mountingHoles ?? []
  const shapes = part.shapes ?? []
  const labels = part.labels ?? []
  const counts = {
    components: shapes.length + labels.length,
    pins: pins.length,
    holes: holes.length,
    image: part.imageData ? 1 : 0
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

  return (
    <section className="pe__section pe__layers">
      <h3 className="pe__h">Layers</h3>

      {/* Components (top) */}
      <div className={`pe__layer${tool === 'rect' || tool === 'circle' || tool === 'cpoly' || tool === 'text' ? ' is-active' : ''}`}>
        <div className="pe__layer-head">
          {caret('components')}
          {eye('components')}
          <span className="pe__layer-name">Components</span>
          <span className="pe__layer-count">{counts.components}</span>
          {delBtn(selection?.type === 'shape' || selection?.type === 'shape-vertex' || selection?.type === 'label')}
        </div>
        {isOpen('components') && (
          <ul className="pe__layer-list">
            {counts.components === 0 && <li className="pe__layer-empty">Add shapes from the toolbar ▸ Shapes.</li>}
            {shapes.map((s, i) => {
              // Stay highlighted while editing one of this shape's polygon vertices.
              const shapeActive =
                (selection?.type === 'shape' || selection?.type === 'shape-vertex') && selection.index === i
              return (
                <li key={`s${i}`}>
                  <button type="button" className={`pe__item${shapeActive ? ' is-active' : ''}`} onClick={() => setSelection({ type: 'shape', index: i })}>
                    <span className="pe__item-name">{s.label || s.kind}</span>
                    <span className="pe__item-sub">{s.kind}</span>
                  </button>
                </li>
              )
            })}
            {labels.map((l, i) => (
              <li key={`l${i}`}>
                <button type="button" className={`pe__item${selEq({ type: 'label', index: i }) ? ' is-active' : ''}`} onClick={() => setSelection({ type: 'label', index: i })}>
                  <span className="pe__item-name">{l.text || '(label)'}</span>
                  <span className="pe__item-sub">text</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Pins */}
      <div className={`pe__layer${tool === 'pin' ? ' is-active' : ''}`}>
        <div className="pe__layer-head">
          {caret('pins')}
          {eye('pins')}
          <span className="pe__layer-name">Pins</span>
          <span className="pe__layer-count">{counts.pins}</span>
          <button type="button" className={`pe__chip pe__chip--add${tool === 'pin' ? ' is-active' : ''}`} onClick={() => setTool('pin')} title="Click the board to add a pin">
            ＋
          </button>
          {delBtn(selection?.type === 'pin')}
        </div>
        {isOpen('pins') && (
          <ul className="pe__layer-list">
            {pins.length === 0 && <li className="pe__layer-empty">No pins yet.</li>}
            {pins.map((rp) => (
              <li key={`p${rp.hi}-${rp.pi}`}>
                <button type="button" className={`pe__item${selEq({ type: 'pin', hi: rp.hi, pi: rp.pi }) ? ' is-active' : ''}`} onClick={() => setSelection({ type: 'pin', hi: rp.hi, pi: rp.pi })}>
                  <span className="pe__item-name">{rp.pin.name || '(pin)'}</span>
                  <span className="pe__item-sub">{rp.pin.type}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Mounting holes */}
      <div className={`pe__layer${tool === 'hole' ? ' is-active' : ''}`}>
        <div className="pe__layer-head">
          {caret('holes')}
          {eye('holes')}
          <span className="pe__layer-name">Mounting holes</span>
          <span className="pe__layer-count">{counts.holes}</span>
          <button type="button" className={`pe__chip pe__chip--add${tool === 'hole' ? ' is-active' : ''}`} onClick={() => setTool('hole')} title="Click the board to add a mounting hole (pins can't sit in holes)">
            ＋
          </button>
          {delBtn(selection?.type === 'hole')}
        </div>
        {isOpen('holes') && (
          <ul className="pe__layer-list">
            {holes.length === 0 && <li className="pe__layer-empty">No holes yet.</li>}
            {holes.map((h, i) => (
              <li key={`h${i}`}>
                <button type="button" className={`pe__item${selEq({ type: 'hole', index: i }) ? ' is-active' : ''}`} onClick={() => setSelection({ type: 'hole', index: i })}>
                  <span className="pe__item-name">Hole {i + 1}</span>
                  <span className="pe__item-sub">⌀{h.diameter}mm</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* PCB (bottom) — shape + image live here */}
      <div className={`pe__layer pe__layer--pcb${tool === 'shape' ? ' is-active' : ''}`}>
        <div className="pe__layer-head">
          {eye('image')}
          <span className="pe__layer-name">PCB / image</span>
          <span className="pe__layer-count">{counts.image ? 'img' : '—'}</span>
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
          <button type="button" className="pe__chip" onClick={() => fileInputRef.current?.click()} title="Upload a board photo onto the PCB layer">
            {part.imageData ? 'Replace image' : '＋ Image'}
          </button>
        </div>
        <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/svg+xml" style={{ display: 'none' }} onChange={onPickImage} />
      </div>
      <p className="pe__hint pe__hint--muted">PCB on the bottom; holes cut through it; pins &amp; components on top.</p>
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
            <input
              type="color"
              value={/^#[0-9a-f]{6}$/i.test(part.pcbColor ?? '') ? (part.pcbColor as string) : '#0f5a2e'}
              onChange={(e) => patch({ pcbColor: e.target.value })}
              title="PCB / board background colour"
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
          <div className="pe__row">
            {num('x', pin.x ?? 0, (v) => updatePin({ x: v }))}
            {num('y', pin.y ?? 0, (v) => updatePin({ y: v }))}
          </div>
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
  } else if (selection.type === 'shape' || selection.type === 'shape-vertex') {
    const si = selection.index
    const shp = (part.shapes ?? [])[si]
    if (shp) {
      title = `Component (${shp.kind})`
      const upd = (p: Partial<ComponentShape>): void =>
        patch({ shapes: (part.shapes ?? []).map((s, i) => (i === si ? { ...s, ...p } : s)) })
      const colour = (val: string | undefined, fallback: string, on: (v: string) => void): JSX.Element => (
        <input type="color" value={/^#[0-9a-f]{6}$/i.test(val ?? '') ? (val as string) : fallback} onChange={(e) => on(e.target.value)} />
      )
      body = (
        <>
          <label className="pe__field">
            <span>Label</span>
            <input type="text" value={shp.label ?? ''} onChange={(e) => upd({ label: e.target.value })} placeholder="(optional)" />
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
            {shp.kind === 'rect' && num('w', shp.w ?? 0.2, (v) => upd({ w: v }))}
            {shp.kind === 'rect' && num('h', shp.h ?? 0.15, (v) => upd({ h: v }))}
            {shp.kind === 'circle' && num('r', shp.r ?? 0.08, (v) => upd({ r: v }))}
          </div>
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
          </div>
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
          <input type="text" value={part.family ?? ''} onChange={(e) => patch({ family: e.target.value })} placeholder="Sensor" />
        </label>
      </div>
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
