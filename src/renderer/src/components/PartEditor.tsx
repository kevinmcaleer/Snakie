import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { BoardView } from './BoardView'
import { PartFootprint } from './PartFootprint'
import { PartSchematicView } from './PartSchematicView'
import {
  CAPABILITIES,
  CAPABILITY_LABEL,
  PACKAGES,
  PART_EDGES,
  PIN_TYPES,
  PIN_TYPE_LABEL,
  blankHeader,
  blankPart,
  blankPin,
  normalisePart,
  partToBoardDefinition,
  pinNames,
  sanitisePartId,
  snapToGrid,
  validatePart
} from './part-editor.util'
import type {
  MountingHole,
  PartButton,
  PartDefinition,
  PartHeader,
  PartLibrary,
  PartPin,
  PartPinCapability,
  PartPinType
} from '../../../shared/part'
import type { PartsWriteResult } from '../../../preload/index.d'
import './PartEditor.css'

/**
 * PART EDITOR (#130)
 * ==================
 *
 * A visual editor that authors a {@link PartDefinition} — the EXACT data the
 * Parts Library stores as `parts.yml` — and persists it via
 * `window.api.parts.savePart`. It has the two views the epic calls for:
 *
 *  - **Breadboard** — the physical design: board meta, dimensions, image, the
 *    pin headers (pin number, GPIO name, type pwr/gnd/io, IO capabilities,
 *    castellated vs regular), mounting holes, buttons, and a live preview that
 *    toggles between the engineering **footprint** and the **life-like**,
 *    full-colour rendering (the latter reuses the Board View's renderer).
 *  - **Schematic** — a simple line-drawing symbol with the pins defined, plus the
 *    pad ↔ pin table that places each pin on a side of the symbol.
 *
 * The on-disk YAML is the round-trippable source of truth (see
 * `part-editor.util.ts`), so loading a saved part re-opens it unchanged for
 * re-editing. Hosted as a full-screen overlay in the main window (mounted by
 * AppShell when the Parts panel requests it).
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
  const [part, setPart] = useState<PartDefinition>(() => initial ?? blankPart())
  const [libId, setLibId] = useState<string>(libraryId)
  const [openedId, setOpenedId] = useState<string | null>(initial?.id ?? null)
  // Editable property rows, kept as their own state so a blank-key row can be
  // typed into (round-tripping through `part.properties` would prune it instantly).
  const [propRows, setPropRows] = useState<[string, string][]>(() =>
    Object.entries(initial?.properties ?? {})
  )
  // Parts of the SELECTED destination library, for the id-collision guard (the
  // user can switch libraries mid-edit, so we re-read on libId change).
  const [destParts, setDestParts] = useState<PartDefinition[]>(existingParts)
  const [view, setView] = useState<'breadboard' | 'schematic'>('schematic')
  const [previewMode, setPreviewMode] = useState<'footprint' | 'lifelike'>('footprint')
  const [snap, setSnap] = useState(true)
  const [status, setStatus] = useState<Status | null>(null)
  const [selectedPin, setSelectedPin] = useState<string | undefined>(undefined)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const fileId = useMemo(() => sanitisePartId(part.id), [part.id])
  const names = useMemo(() => pinNames(part), [part])
  const spacing = part.pinSpacing && part.pinSpacing > 0 ? part.pinSpacing : 2.54

  // --- immutable update helpers --------------------------------------------
  const patch = (p: Partial<PartDefinition>): void => setPart((d) => ({ ...d, ...p }))
  const setHeaders = (headers: PartHeader[]): void => patch({ headers })

  const updateHeader = (hi: number, p: Partial<PartHeader>): void =>
    setHeaders(part.headers.map((h, i) => (i === hi ? { ...h, ...p } : h)))
  const updatePin = (hi: number, pi: number, p: Partial<PartPin>): void =>
    setHeaders(
      part.headers.map((h, i) =>
        i === hi ? { ...h, pins: h.pins.map((pin, j) => (j === pi ? { ...pin, ...p } : pin)) } : h
      )
    )
  const addHeader = (): void => setHeaders([...part.headers, blankHeader('left')])
  const removeHeader = (hi: number): void => setHeaders(part.headers.filter((_, i) => i !== hi))
  const addPin = (hi: number): void =>
    setHeaders(part.headers.map((h, i) => (i === hi ? { ...h, pins: [...h.pins, blankPin()] } : h)))
  const removePin = (hi: number, pi: number): void =>
    setHeaders(
      part.headers.map((h, i) => (i === hi ? { ...h, pins: h.pins.filter((_, j) => j !== pi) } : h))
    )
  const movePin = (hi: number, pi: number, dir: -1 | 1): void => {
    const h = part.headers[hi]
    const j = pi + dir
    if (j < 0 || j >= h.pins.length) return
    const pins = [...h.pins]
    ;[pins[pi], pins[j]] = [pins[j], pins[pi]]
    updateHeader(hi, { pins })
  }
  const toggleCap = (hi: number, pi: number, cap: PartPinCapability): void => {
    const pin = part.headers[hi].pins[pi]
    const has = pin.capabilities?.includes(cap)
    const next = has
      ? (pin.capabilities ?? []).filter((c) => c !== cap)
      : [...(pin.capabilities ?? []), cap]
    updatePin(hi, pi, { capabilities: next })
  }

  // mounting holes
  const setHoles = (mountingHoles: MountingHole[]): void => patch({ mountingHoles })
  const addHole = (): void =>
    setHoles([...(part.mountingHoles ?? []), { x: 0.1, y: 0.1, diameter: 2 }])
  const updateHole = (i: number, p: Partial<MountingHole>): void =>
    setHoles((part.mountingHoles ?? []).map((h, j) => (j === i ? { ...h, ...p } : h)))
  const removeHole = (i: number): void =>
    setHoles((part.mountingHoles ?? []).filter((_, j) => j !== i))

  // buttons
  const setButtons = (buttons: PartButton[]): void => patch({ buttons })
  const addButton = (): void =>
    setButtons([...(part.buttons ?? []), { label: 'BTN', x: 0.5, y: 0.5 }])
  const updateButton = (i: number, p: Partial<PartButton>): void =>
    setButtons((part.buttons ?? []).map((b, j) => (j === i ? { ...b, ...p } : b)))
  const removeButton = (i: number): void =>
    setButtons((part.buttons ?? []).filter((_, j) => j !== i))

  // properties (user key/values) — `propRows` is the editable source of truth
  // (so empty-key rows survive while typing); `part.properties` is derived from
  // it (pruning empty keys) for the preview + save.
  const setProps = (rows: [string, string][]): void => {
    setPropRows(rows)
    const properties: Record<string, string> = {}
    for (const [k, v] of rows) if (k.trim()) properties[k] = v
    patch({ properties })
  }
  const snapPos = (v: number): number => (snap ? snapToGrid(v, spacing, undefined) : v)

  // Re-read the destination library's parts whenever the target library changes,
  // so the save-time id-collision check reflects where the part will actually go.
  useEffect(() => {
    let cancelled = false
    window.api.parts
      .listLibraries()
      .then((libs) => {
        if (cancelled) return
        setDestParts(libs.find((l) => l.id === libId)?.parts ?? [])
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [libId])

  // --- image upload ---------------------------------------------------------
  const onPickImage = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') patch({ imageData: reader.result })
    }
    reader.onerror = () => setStatus({ kind: 'error', text: 'Could not read that image.' })
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  // --- persistence ----------------------------------------------------------
  const newPart = (): void => {
    setPart(blankPart())
    setPropRows([])
    setOpenedId(null)
    setStatus({ kind: 'info', text: 'Started a new blank part.' })
  }

  const save = async (): Promise<void> => {
    // Validate the RAW part so the "give it a name" guard is reachable (the
    // normalised part always has a non-empty fallback id).
    const err = validatePart(part)
    if (err) {
      setStatus({ kind: 'error', text: err })
      return
    }
    const clean = normalisePart(part)
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
    // Carry the runtime image data URL through so main writes the asset.
    const payload: PartDefinition = { ...clean, imageData: part.imageData }
    const res: PartsWriteResult = await window.api.parts.savePart(libId, payload)
    if (res.ok) {
      setOpenedId(clean.id)
      setDestParts((prev) =>
        prev.some((p) => p.id === clean.id) ? prev : [...prev, clean]
      )
      setStatus({ kind: 'ok', text: `Saved "${clean.name}" to ${res.libraryId ?? libId}.` })
      onSaved(res.libraryId ?? libId, res.id ?? clean.id)
    } else {
      setStatus({ kind: 'error', text: res.error ?? 'Save failed.' })
    }
  }

  // Carry the runtime image data URL past normalisation so the life-like preview
  // can draw it (normalisePart only keeps the on-disk `image` filename).
  const previewBoard = useMemo(
    () => partToBoardDefinition({ ...normalisePart(part), imageData: part.imageData }),
    [part]
  )

  return (
    <div className="pe" role="dialog" aria-label="Part Editor" aria-modal="true">
      <header className="pe__bar">
        <span className="pe__title">PART EDITOR</span>
        <div className="pe__viewtabs" role="tablist" aria-label="Editor view">
          <button
            type="button"
            role="tab"
            aria-selected={view === 'schematic'}
            className={`pe__tab${view === 'schematic' ? ' is-active' : ''}`}
            onClick={() => setView('schematic')}
          >
            Schematic
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'breadboard'}
            className={`pe__tab${view === 'breadboard' ? ' is-active' : ''}`}
            onClick={() => setView('breadboard')}
          >
            Breadboard
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
        <div className="pe__panels">
          {view === 'breadboard' ? (
            <BreadboardPanels
              part={part}
              fileId={fileId}
              snap={snap}
              setSnap={setSnap}
              snapPos={snapPos}
              patch={patch}
              names={names}
              propRows={propRows}
              setProps={setProps}
              fileInputRef={fileInputRef}
              onPickImage={onPickImage}
              addHeader={addHeader}
              removeHeader={removeHeader}
              updateHeader={updateHeader}
              addPin={addPin}
              removePin={removePin}
              updatePin={updatePin}
              movePin={movePin}
              toggleCap={toggleCap}
              setSelectedPin={setSelectedPin}
              addHole={addHole}
              updateHole={updateHole}
              removeHole={removeHole}
              addButton={addButton}
              updateButton={updateButton}
              removeButton={removeButton}
            />
          ) : (
            <SchematicPanels part={part} patch={patch} setSelectedPin={setSelectedPin} />
          )}
        </div>

        <div className="pe__preview">
          <div className="pe__preview-head">
            {view === 'breadboard' ? (
              <div className="pe__seg" role="tablist" aria-label="Preview mode">
                <button
                  type="button"
                  className={`pe__seg-btn${previewMode === 'footprint' ? ' is-active' : ''}`}
                  onClick={() => setPreviewMode('footprint')}
                >
                  Footprint
                </button>
                <button
                  type="button"
                  className={`pe__seg-btn${previewMode === 'lifelike' ? ' is-active' : ''}`}
                  onClick={() => setPreviewMode('lifelike')}
                >
                  Life-like
                </button>
              </div>
            ) : (
              <span className="pe__preview-title">Schematic symbol</span>
            )}
          </div>
          <div className="pe__preview-stage">
            {view === 'schematic' ? (
              <PartSchematicView part={part} highlightPin={selectedPin} />
            ) : previewMode === 'footprint' ? (
              <PartFootprint part={part} showGrid={snap} highlightPin={selectedPin} />
            ) : (
              <BoardView source="" isPython={false} previewDef={previewBoard} />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// --- Breadboard view panels -------------------------------------------------

interface BreadboardPanelsProps {
  part: PartDefinition
  fileId: string
  snap: boolean
  setSnap: (b: boolean) => void
  snapPos: (v: number) => number
  patch: (p: Partial<PartDefinition>) => void
  names: string[]
  propRows: [string, string][]
  setProps: (rows: [string, string][]) => void
  fileInputRef: React.RefObject<HTMLInputElement>
  onPickImage: (e: React.ChangeEvent<HTMLInputElement>) => void
  addHeader: () => void
  removeHeader: (hi: number) => void
  updateHeader: (hi: number, p: Partial<PartHeader>) => void
  addPin: (hi: number) => void
  removePin: (hi: number, pi: number) => void
  updatePin: (hi: number, pi: number, p: Partial<PartPin>) => void
  movePin: (hi: number, pi: number, dir: -1 | 1) => void
  toggleCap: (hi: number, pi: number, cap: PartPinCapability) => void
  setSelectedPin: (name: string | undefined) => void
  addHole: () => void
  updateHole: (i: number, p: Partial<MountingHole>) => void
  removeHole: (i: number) => void
  addButton: () => void
  updateButton: (i: number, p: Partial<PartButton>) => void
  removeButton: (i: number) => void
}

function BreadboardPanels(props: BreadboardPanelsProps): JSX.Element {
  const { part, patch, snapPos } = props
  return (
    <>
      {/* Identity */}
      <section className="pe__section">
        <h3 className="pe__h">Part</h3>
        <label className="pe__field">
          <span>Name</span>
          <input
            type="text"
            value={part.name}
            onChange={(e) =>
              patch({ name: e.target.value, id: sanitisePartId(e.target.value) || part.id })
            }
            placeholder="VL53L0X ToF"
          />
        </label>
        <label className="pe__field">
          <span>Description</span>
          <input
            type="text"
            value={part.description ?? ''}
            onChange={(e) => patch({ description: e.target.value })}
            placeholder="Time-of-flight distance sensor"
          />
        </label>
        <div className="pe__row">
          <label className="pe__field">
            <span>Manufacturer</span>
            <input
              type="text"
              value={part.manufacturer ?? ''}
              onChange={(e) => patch({ manufacturer: e.target.value })}
              placeholder="Pimoroni"
            />
          </label>
          <label className="pe__field">
            <span>Family</span>
            <input
              type="text"
              value={part.family ?? ''}
              onChange={(e) => patch({ family: e.target.value })}
              placeholder="Sensor"
            />
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
            <span>Voltage</span>
            <input
              type="text"
              value={part.voltage ?? ''}
              onChange={(e) => patch({ voltage: e.target.value })}
              placeholder="3.3V"
            />
          </label>
          <label className="pe__field">
            <span>Part #</span>
            <input
              type="text"
              value={part.partNumber ?? ''}
              onChange={(e) => patch({ partNumber: e.target.value })}
              placeholder="SC0918"
            />
          </label>
          <label className="pe__field">
            <span>Version</span>
            <input
              type="text"
              value={part.version ?? ''}
              onChange={(e) => patch({ version: e.target.value })}
              placeholder="1.0.0"
            />
          </label>
        </div>
        <p className="pe__hint">
          Saves as <code>{props.fileId || '—'}/parts.yml</code>
        </p>
      </section>

      {/* Physical */}
      <section className="pe__section">
        <h3 className="pe__h">Physical</h3>
        <div className="pe__row">
          <label className="pe__field">
            <span>Package</span>
            <select
              value={part.package ?? 'THT'}
              onChange={(e) => patch({ package: e.target.value as PartDefinition['package'] })}
            >
              {PACKAGES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <label className="pe__field">
            <span>Pin spacing (mm)</span>
            <input
              type="number"
              step="0.01"
              value={part.pinSpacing ?? 2.54}
              onChange={(e) => patch({ pinSpacing: Number(e.target.value) || 2.54 })}
            />
          </label>
        </div>
        <div className="pe__row">
          <label className="pe__field">
            <span>Width (mm)</span>
            <input
              type="number"
              step="0.1"
              value={part.dimensions?.width ?? ''}
              onChange={(e) =>
                patch({
                  dimensions: {
                    width: Number(e.target.value) || 0,
                    height: part.dimensions?.height ?? 0
                  }
                })
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
                patch({
                  dimensions: {
                    width: part.dimensions?.width ?? 0,
                    height: Number(e.target.value) || 0
                  }
                })
              }
            />
          </label>
        </div>
        <div className="pe__row">
          <label className="pe__field">
            <span>PCB colour</span>
            <input
              type="color"
              value={/^#[0-9a-f]{6}$/i.test(part.pcbColor ?? '') ? (part.pcbColor as string) : '#0f5a2e'}
              onChange={(e) => patch({ pcbColor: e.target.value })}
            />
          </label>
          <label className="pe__field">
            <span>MCU / chip</span>
            <input
              type="text"
              value={part.mcu ?? ''}
              onChange={(e) => patch({ mcu: e.target.value })}
              placeholder="RP2350"
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

      {/* Image */}
      <section className="pe__section">
        <h3 className="pe__h">Image</h3>
        <p className="pe__hint">
          A photo/SVG of the board with pins ideally in a vertical arrangement (per the spec). Stored as
          an asset next to <code>parts.yml</code>.
        </p>
        <div className="pe__row">
          <button type="button" className="pe__btn" onClick={() => props.fileInputRef.current?.click()}>
            Upload image…
          </button>
          {part.imageData && (
            <button type="button" className="pe__btn pe__btn--danger" onClick={() => patch({ imageData: undefined, image: undefined })}>
              Remove image
            </button>
          )}
          <input
            ref={props.fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/svg+xml"
            style={{ display: 'none' }}
            onChange={props.onPickImage}
          />
        </div>
        {part.imageData && <p className="pe__hint">Image attached ({Math.round(part.imageData.length / 1024)} KB).</p>}
      </section>

      {/* Headers & pins */}
      <section className="pe__section">
        <h3 className="pe__h">
          Headers &amp; pins
          <button type="button" className="pe__add" onClick={props.addHeader}>
            + Add header
          </button>
        </h3>
        <p className="pe__hint">
          A header is a row of pins along one edge (left/right = vertical, top/bottom = horizontal).
          IO pins carry a GPIO number + capabilities; power/ground pins do not.
        </p>
        {part.headers.map((h, hi) => (
          <div className="pe__header" key={hi}>
            <div className="pe__row pe__header-head">
              <select value={h.edge} onChange={(e) => props.updateHeader(hi, { edge: e.target.value as PartHeader['edge'] })}>
                {PART_EDGES.map((edge) => (
                  <option key={edge} value={edge}>
                    {edge}
                  </option>
                ))}
              </select>
              <span className="pe__count">{h.pins.length} pin{h.pins.length === 1 ? '' : 's'}</span>
              <span className="pe__spacer" />
              <button type="button" className="pe__icon pe__icon--danger" onClick={() => props.removeHeader(hi)} title="Delete header">
                ✕
              </button>
            </div>
            {h.pins.map((pin, pi) => (
              <PinRow
                key={pi}
                pin={pin}
                index={pi}
                count={h.pins.length}
                onFocusPin={() => props.setSelectedPin(pin.name)}
                onChange={(p) => props.updatePin(hi, pi, p)}
                onMove={(dir) => props.movePin(hi, pi, dir)}
                onRemove={() => props.removePin(hi, pi)}
                onToggleCap={(c) => props.toggleCap(hi, pi, c)}
              />
            ))}
            <button type="button" className="pe__add pe__add--inline" onClick={() => props.addPin(hi)}>
              + Add pin
            </button>
          </div>
        ))}
      </section>

      {/* Mounting holes */}
      <section className="pe__section">
        <h3 className="pe__h">
          Mounting holes
          <button type="button" className="pe__add" onClick={props.addHole}>
            + Add
          </button>
        </h3>
        <label className="pe__check pe__check--snap">
          <input type="checkbox" checked={props.snap} onChange={(e) => props.setSnap(e.target.checked)} />
          Snap positions to {(part.pinSpacing ?? 2.54).toFixed(2)}mm grid
        </label>
        {(part.mountingHoles ?? []).map((hole, i) => (
          <div className="pe__row pe__subitem" key={i}>
            <label className="pe__num">
              <span>x</span>
              <input type="number" step="0.01" value={hole.x} onChange={(e) => props.updateHole(i, { x: snapPos(Number(e.target.value)) })} />
            </label>
            <label className="pe__num">
              <span>y</span>
              <input type="number" step="0.01" value={hole.y} onChange={(e) => props.updateHole(i, { y: snapPos(Number(e.target.value)) })} />
            </label>
            <label className="pe__num">
              <span>⌀mm</span>
              <input type="number" step="0.1" value={hole.diameter} onChange={(e) => props.updateHole(i, { diameter: Number(e.target.value) || 2 })} />
            </label>
            <button type="button" className="pe__icon pe__icon--danger" onClick={() => props.removeHole(i)} title="Delete hole">
              ✕
            </button>
          </div>
        ))}
      </section>

      {/* Buttons */}
      <section className="pe__section">
        <h3 className="pe__h">
          Buttons
          <button type="button" className="pe__add" onClick={props.addButton}>
            + Add
          </button>
        </h3>
        {(part.buttons ?? []).map((b, i) => (
          <div className="pe__row pe__subitem" key={i}>
            <input className="pe__grow" type="text" value={b.label} placeholder="BOOT" onChange={(e) => props.updateButton(i, { label: e.target.value })} />
            <label className="pe__num">
              <span>x</span>
              <input type="number" step="0.01" value={b.x} onChange={(e) => props.updateButton(i, { x: snapPos(Number(e.target.value)) })} />
            </label>
            <label className="pe__num">
              <span>y</span>
              <input type="number" step="0.01" value={b.y} onChange={(e) => props.updateButton(i, { y: snapPos(Number(e.target.value)) })} />
            </label>
            <button type="button" className="pe__icon pe__icon--danger" onClick={() => props.removeButton(i)} title="Delete button">
              ✕
            </button>
          </div>
        ))}
      </section>

      {/* Properties (user key/values) */}
      <section className="pe__section">
        <h3 className="pe__h">
          Properties
          <button type="button" className="pe__add" onClick={() => props.setProps([...props.propRows, ['', '']])}>
            + Add
          </button>
        </h3>
        <p className="pe__hint">Arbitrary spec rows (key → value), e.g. range → 2m.</p>
        {props.propRows.map(([k, v], i) => (
          <div className="pe__row pe__subitem" key={i}>
            <input
              className="pe__grow"
              type="text"
              value={k}
              placeholder="key"
              onChange={(e) => props.setProps(props.propRows.map((p, j) => (j === i ? [e.target.value, p[1]] : p)))}
            />
            <input
              className="pe__grow"
              type="text"
              value={v}
              placeholder="value"
              onChange={(e) => props.setProps(props.propRows.map((p, j) => (j === i ? [p[0], e.target.value] : p)))}
            />
            <button
              type="button"
              className="pe__icon pe__icon--danger"
              onClick={() => props.setProps(props.propRows.filter((_, j) => j !== i))}
              title="Delete property"
            >
              ✕
            </button>
          </div>
        ))}
      </section>
    </>
  )
}

/** One editable pin row in the breadboard view. */
function PinRow({
  pin,
  index,
  count,
  onFocusPin,
  onChange,
  onMove,
  onRemove,
  onToggleCap
}: {
  pin: PartPin
  index: number
  count: number
  onFocusPin: () => void
  onChange: (p: Partial<PartPin>) => void
  onMove: (dir: -1 | 1) => void
  onRemove: () => void
  onToggleCap: (c: PartPinCapability) => void
}): JSX.Element {
  return (
    <div className="pe__pin" onFocusCapture={onFocusPin} onMouseEnter={onFocusPin}>
      <div className="pe__pin-main">
        <input
          className="pe__pin-num"
          type="number"
          value={pin.number ?? ''}
          placeholder="#"
          title="Board pin number"
          onChange={(e) => onChange({ number: e.target.value === '' ? undefined : Number(e.target.value) })}
        />
        <select
          className="pe__pin-type"
          value={pin.type}
          title="Pin type"
          onChange={(e) => onChange({ type: e.target.value as PartPinType })}
        >
          {PIN_TYPES.map((t) => (
            <option key={t} value={t}>
              {PIN_TYPE_LABEL[t]}
            </option>
          ))}
        </select>
        <input
          className="pe__pin-name"
          type="text"
          value={pin.name}
          placeholder="GP0 / SDA / VCC"
          title="GPIO / signal name"
          onChange={(e) => onChange({ name: e.target.value })}
        />
        {pin.type === 'io' && (
          <input
            className="pe__pin-gpio"
            type="number"
            value={pin.gpio ?? ''}
            placeholder="gpio"
            title="GPIO number"
            onChange={(e) => onChange({ gpio: e.target.value === '' ? undefined : Number(e.target.value) })}
          />
        )}
        <button type="button" className="pe__icon" onClick={() => onMove(-1)} disabled={index === 0} title="Move up">
          ↑
        </button>
        <button type="button" className="pe__icon" onClick={() => onMove(1)} disabled={index === count - 1} title="Move down">
          ↓
        </button>
        <button type="button" className="pe__icon pe__icon--danger" onClick={onRemove} title="Delete pin">
          ✕
        </button>
      </div>
      <div className="pe__pin-meta">
        <label className="pe__check" title="Castellated edge pad vs regular header hole">
          <input type="checkbox" checked={!!pin.castellated} onChange={(e) => onChange({ castellated: e.target.checked })} />
          Castellated
        </label>
        {pin.type === 'io' && (
          <span className="pe__caps">
            {CAPABILITIES.map((c) => (
              <label key={c} className={`pe__cap${pin.capabilities?.includes(c) ? ' is-on' : ''}`}>
                <input
                  type="checkbox"
                  checked={!!pin.capabilities?.includes(c)}
                  onChange={() => onToggleCap(c)}
                />
                {CAPABILITY_LABEL[c]}
              </label>
            ))}
          </span>
        )}
      </div>
    </div>
  )
}

// --- Schematic view panels --------------------------------------------------

function SchematicPanels({
  part,
  patch,
  setSelectedPin
}: {
  part: PartDefinition
  patch: (p: Partial<PartDefinition>) => void
  setSelectedPin: (name: string | undefined) => void
}): JSX.Element {
  // The pad ↔ pin table: each physical pin maps to a schematic symbol side.
  // Derived from headers by default; editing here writes part.schematic.pins.
  // Addressed by ROW INDEX (not pin name) so same-named pins (e.g. multiple GND)
  // are edited independently rather than moving together.
  const allPins: { name: string; side: PartHeader['edge']; order: number }[] = []
  if (part.schematic?.pins?.length) {
    part.schematic.pins.forEach((sp) => allPins.push({ name: sp.pin, side: sp.side, order: sp.order }))
  } else {
    part.headers.forEach((h) => h.pins.forEach((p, i) => allPins.push({ name: p.name, side: h.edge, order: i })))
  }

  const setMapping = (
    index: number,
    p: Partial<{ side: PartHeader['edge']; order: number }>
  ): void => {
    const next = allPins.map((row, i) => (i === index ? { ...row, ...p } : row))
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
          Start here: define the pins (in the Breadboard view) then place each on a side of the symbol.
          Connect pads ↔ pins with the table below; the symbol updates live on the right.
        </p>
      </section>
      <section className="pe__section">
        <h3 className="pe__h">Pad ↔ pin table</h3>
        {allPins.length === 0 && <p className="pe__hint">No pins yet — add some in the Breadboard view.</p>}
        {allPins.map((row, i) => (
          <div className="pe__row pe__subitem" key={i} onMouseEnter={() => setSelectedPin(row.name)}>
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
