import { useMemo, useRef, useState, type JSX } from 'react'
import { PartSchematicView } from './PartSchematicView'
import {
  PartCanvas,
  CANVAS_TOOLS,
  type CanvasSelection,
  type CanvasTool
} from './PartCanvas'
import {
  CAPABILITIES,
  CAPABILITY_LABEL,
  PACKAGES,
  PART_EDGES,
  PIN_TYPES,
  PIN_TYPE_LABEL,
  blankPart,
  normalisePart,
  pinNames,
  resolvedPins,
  sanitisePartId,
  validatePart,
  withPinPositions
} from './part-editor.util'
import type {
  ImageLayer,
  MountingHole,
  PartButton,
  PartDefinition,
  PartHeader,
  PartLabel,
  PartLibrary,
  PartPin,
  PartPinCapability,
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

export function PartEditor({
  libraryId,
  initial,
  existingParts,
  libraries,
  onClose,
  onSaved
}: PartEditorProps): JSX.Element {
  // Seed with every pin given an absolute x/y (so the canvas + inspector always
  // have real positions — see withPinPositions).
  const [part, setPart] = useState<PartDefinition>(() => withPinPositions(initial ?? blankPart()))
  const [libId, setLibId] = useState<string>(libraryId)
  const [openedId, setOpenedId] = useState<string | null>(initial?.id ?? null)
  const [propRows, setPropRows] = useState<[string, string][]>(() =>
    Object.entries(initial?.properties ?? {})
  )
  const [view, setView] = useState<'breadboard' | 'schematic'>('breadboard')
  const [showImage, setShowImage] = useState(true)
  const [showGrid, setShowGrid] = useState(false)
  const [snap, setSnap] = useState(false)
  const [tool, setTool] = useState<CanvasTool>('select')
  const [selection, setSelection] = useState<CanvasSelection>(null)
  const [fitSignal, setFitSignal] = useState(0)
  const [status, setStatus] = useState<Status | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const fileId = useMemo(() => sanitisePartId(part.id), [part.id])
  const names = useMemo(() => pinNames(part), [part])

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
        setShowImage(true)
        setSelection({ type: 'image' })
        setTool('select')
        setStatus({ kind: 'info', text: 'Image added as a layer — drag it / its corners to place + size it.' })
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
    } else if (sel.type === 'button') {
      patch({ buttons: (part.buttons ?? []).filter((_, i) => i !== sel.index) })
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

  // --- persistence ----------------------------------------------------------
  const newPart = (): void => {
    setPart(withPinPositions(blankPart()))
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
    const collision =
      sanitisePartId(openedId ?? '') !== clean.id &&
      destParts.some((p) => sanitisePartId(p.id) === clean.id)
    if (collision) {
      setStatus({
        kind: 'error',
        text: `A part with id "${clean.id}" already exists in this library. Rename it, or open it to edit.`
      })
      return
    }
    const payload: PartDefinition = { ...clean, imageData: part.imageData }
    const res: PartsWriteResult = await window.api.parts.savePart(libId, payload)
    if (res.ok) {
      setOpenedId(clean.id)
      setStatus({ kind: 'ok', text: `Saved "${clean.name}" to ${res.libraryId ?? libId}.` })
      onSaved(res.libraryId ?? libId, res.id ?? clean.id)
    } else {
      setStatus({ kind: 'error', text: res.error ?? 'Save failed.' })
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
        <label className="pe__libsel" title="Library to save into">
          <span>Library</span>
          <select value={libId} onChange={(e) => setLibId(e.target.value)}>
            {!libraries.some((l) => l.id === 'my-parts') && <option value="my-parts">My Parts</option>}
            {libraries.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
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
            <div className="pe__panels">
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
                patch={patch}
                setPart={setPart}
                deleteSelection={deleteSelection}
              />
            </div>

            <div className="pe__canvaspane">
              <div className="pe__toolbar">
                {CANVAS_TOOLS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className={`pe__tool${tool === t.id ? ' is-active' : ''}`}
                    title={t.hint}
                    onClick={() => setTool(t.id)}
                  >
                    {t.label}
                  </button>
                ))}
                <span className="pe__spacer" />
                <div className="pe__seg" role="group" aria-label="Image visibility">
                  <button
                    type="button"
                    className={`pe__seg-btn${showImage ? ' is-active' : ''}`}
                    onClick={() => setShowImage(true)}
                    title="Show the board image (life-like)"
                  >
                    Life-like
                  </button>
                  <button
                    type="button"
                    className={`pe__seg-btn${!showImage ? ' is-active' : ''}`}
                    onClick={() => setShowImage(false)}
                    title="Hide the image (footprint — pads & holes only)"
                  >
                    Footprint
                  </button>
                </div>
                <label className="pe__toolcheck" title="Show the pin-spacing grid">
                  <input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} /> Grid
                </label>
                <label className="pe__toolcheck" title="Snap placement to the pin-spacing grid">
                  <input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} /> Snap
                </label>
                <button type="button" className="pe__tool" onClick={() => setFitSignal((n) => n + 1)} title="Reset pan / zoom">
                  Fit
                </button>
              </div>
              <div className="pe__canvas-stage">
                <PartCanvas
                  part={part}
                  showImage={showImage}
                  showGrid={showGrid}
                  snap={snap}
                  tool={tool}
                  selection={selection}
                  onChange={setPart}
                  onSelect={setSelection}
                  resetSignal={fitSignal}
                />
              </div>
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

      {/* Board shape + size */}
      <section className="pe__section">
        <h3 className="pe__h">Board</h3>
        <div className="pe__row">
          <label className="pe__field">
            <span>Shape</span>
            <select
              value={part.shape?.kind ?? 'rect'}
              onChange={(e) => {
                const kind = e.target.value as 'rect' | 'polygon'
                if (kind === 'polygon' && (part.polygon?.length ?? 0) < 3) {
                  // Seed a rectangle polygon the user can then reshape.
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
              }}
            >
              <option value="rect">Rectangle</option>
              <option value="polygon">Polygon</option>
            </select>
          </label>
          <label className="pe__field">
            <span>PCB colour</span>
            <input
              type="color"
              value={/^#[0-9a-f]{6}$/i.test(part.pcbColor ?? '') ? (part.pcbColor as string) : '#0f5a2e'}
              onChange={(e) => patch({ pcbColor: e.target.value })}
            />
          </label>
        </div>
        {part.shape?.kind === 'polygon' ? (
          <p className="pe__hint">Pick the <strong>Shape</strong> tool, then drag the vertices (or click the board edge to add one).</p>
        ) : (
          <label className="pe__field">
            <span>Corner radius</span>
            <input
              type="range"
              min="0"
              max="0.5"
              step="0.02"
              value={part.shape?.cornerRadius ?? 0.04}
              onChange={(e) => patch({ shape: { kind: 'rect', cornerRadius: Number(e.target.value) } })}
            />
          </label>
        )}
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

      {/* Image layer */}
      <section className="pe__section">
        <h3 className="pe__h">Image layer</h3>
        <p className="pe__hint">
          The board photo is its own layer — upload it, then drag it (and its corner handles) on the canvas to match
          the real board. Components sit on top.
        </p>
        <div className="pe__row">
          <button type="button" className="pe__btn" onClick={() => props.fileInputRef.current?.click()}>
            {part.imageData ? 'Replace image…' : 'Upload image…'}
          </button>
          {part.imageData && (
            <>
              <button type="button" className="pe__btn" onClick={() => props.setImageLayer({ x: 0, y: 0, w: 1, h: 1 })} title="Reset the image to cover the board">
                Fit
              </button>
              <button type="button" className="pe__btn pe__btn--danger" onClick={props.removeImage}>
                Remove
              </button>
            </>
          )}
          <input
            ref={props.fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/svg+xml"
            style={{ display: 'none' }}
            onChange={props.onPickImage}
          />
        </div>
        {part.imageData && (
          <label className="pe__field">
            <span>Opacity</span>
            <input
              type="range"
              min="0.1"
              max="1"
              step="0.05"
              value={part.imageLayer?.opacity ?? 1}
              onChange={(e) => props.setImageLayer({ opacity: Number(e.target.value) })}
            />
          </label>
        )}
        <p className="pe__hint pe__hint--muted">Crop + magic-wand background removal land in the next pass.</p>
      </section>

      {/* Identity / catalogue metadata (collapsible) */}
      <section className="pe__section">
        <h3 className="pe__h">
          Details
          <button type="button" className="pe__add" onClick={() => props.setDetailsOpen(!props.detailsOpen)}>
            {props.detailsOpen ? 'Hide' : 'Show'}
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
          Saves as <code>{props.fileId || '—'}/parts.yml</code>
        </p>
        {props.detailsOpen && <DetailsFields part={part} patch={patch} propRows={props.propRows} setProps={props.setProps} />}
      </section>
    </>
  )
}

/** The editable fields for whatever is selected on the canvas. */
function SelectionInspector({
  part,
  selection,
  setPart,
  patch,
  setImageLayer,
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
          <label className="pe__check">
            <input type="checkbox" checked={!!pin.castellated} onChange={(e) => updatePin({ castellated: e.target.checked })} /> Castellated
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
            <input type="text" value={btn.label} onChange={(e) => upd({ label: e.target.value })} />
          </label>
          <div className="pe__row">
            {num('x', btn.x, (v) => upd({ x: v }))}
            {num('y', btn.y, (v) => upd({ y: v }))}
          </div>
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
        <label className="pe__field">
          <span>Opacity</span>
          <input type="range" min="0.1" max="1" step="0.05" value={layer.opacity ?? 1} onChange={(e) => setImageLayer({ opacity: Number(e.target.value) })} />
        </label>
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
