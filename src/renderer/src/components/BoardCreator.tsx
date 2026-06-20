import { useMemo, useRef, useState } from 'react'
import { BoardView } from './BoardView'
import {
  type BoardDefinition,
  type BoardFeature,
  type BoardHeader,
  type BoardPad,
  type BoardPadType
} from './board-defs'
import {
  FEATURE_KINDS,
  HEADER_EDGES,
  PAD_TYPES,
  PAD_TYPE_LABEL,
  blankBoard,
  blankFeature,
  blankHeader,
  blankPad,
  idCollides,
  ledLabelOptions,
  normaliseBoard,
  sanitiseBoardId,
  validateBoard
} from './board-creator.util'
import './BoardCreator.css'

/**
 * BOARD CREATOR (issue #94)
 * =========================
 *
 * A visual editor that authors a {@link BoardDefinition} — the EXACT JSON the
 * Board View already consumes — and persists it to `<userData>/boards/<id>.json`
 * via `window.api.board.saveUserBoard`.
 *
 * The JSON is the **single round-trippable source of truth**: features are
 * structured rectangles (not a flattened SVG), the uploaded image is stored as a
 * data URL, pins are structured pads — so "Load existing" re-opens any saved
 * board straight back into the editor for re-editing. The "Export SVG" button is
 * a one-way convenience (it serialises the live preview's `<svg>`); it is NOT how
 * boards are stored or re-loaded.
 *
 * The live preview renders the working definition through the SAME
 * {@link BoardView} drawing code (in `previewDef` mode) so what you see is
 * exactly what the view will draw, including the new power-pad colours + image
 * background.
 */

export interface BoardCreatorProps {
  /** Existing user boards (for the "Load existing" picker + id-collision warn). */
  userBoards: BoardDefinition[]
  /** Persist `def`; resolves to `{ok,error}`. Wired to `board.saveUserBoard`. */
  onSave: (def: BoardDefinition) => Promise<{ ok: boolean; error?: string }>
  /** Delete a user board by id. Wired to `board.deleteUserBoard`. */
  onDelete: (id: string) => Promise<void>
  /** Leave the creator (back to the read-only Board View). */
  onDone: () => void
  /** Whether this is hosted as the floating window's root (drag region chrome). */
  asWindow?: boolean
}

/** A short status line under the toolbar (save success / error / hint). */
interface Status {
  kind: 'ok' | 'error' | 'info'
  text: string
}

export function BoardCreator({
  userBoards,
  onSave,
  onDelete,
  onDone,
  asWindow = false
}: BoardCreatorProps): JSX.Element {
  // The working definition we edit. Starts as a blank template.
  const [def, setDef] = useState<BoardDefinition>(() => blankBoard())
  // The id of the board currently loaded from disk (null for a brand-new one) —
  // used so re-saving an opened board doesn't warn about an id "collision".
  const [openedId, setOpenedId] = useState<string | null>(null)
  const [status, setStatus] = useState<Status | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const previewHostRef = useRef<HTMLDivElement>(null)

  // The id the file will be written under (mirrors the main-process sanitiser).
  const fileId = useMemo(() => sanitiseBoardId(def.id), [def.id])

  // --- Mutation helpers (immutable updates on the working def) --------------
  const patch = (p: Partial<BoardDefinition>): void => setDef((d) => ({ ...d, ...p }))

  const setHeaders = (headers: BoardHeader[]): void => patch({ headers })
  const setFeatures = (features: BoardFeature[]): void => patch({ features })

  const updateHeader = (hi: number, p: Partial<BoardHeader>): void =>
    setHeaders(def.headers.map((h, i) => (i === hi ? { ...h, ...p } : h)))

  const updatePad = (hi: number, pi: number, p: Partial<BoardPad>): void =>
    setHeaders(
      def.headers.map((h, i) =>
        i === hi ? { ...h, pins: h.pins.map((pad, j) => (j === pi ? { ...pad, ...p } : pad)) } : h
      )
    )

  const addHeader = (): void => setHeaders([...def.headers, blankHeader('left')])
  const removeHeader = (hi: number): void =>
    setHeaders(def.headers.filter((_, i) => i !== hi))
  const moveHeader = (hi: number, dir: -1 | 1): void => {
    const j = hi + dir
    if (j < 0 || j >= def.headers.length) return
    const next = [...def.headers]
    ;[next[hi], next[j]] = [next[j], next[hi]]
    setHeaders(next)
  }

  const addPad = (hi: number): void =>
    setHeaders(def.headers.map((h, i) => (i === hi ? { ...h, pins: [...h.pins, blankPad()] } : h)))
  const removePad = (hi: number, pi: number): void =>
    setHeaders(
      def.headers.map((h, i) =>
        i === hi ? { ...h, pins: h.pins.filter((_, j) => j !== pi) } : h
      )
    )
  const movePad = (hi: number, pi: number, dir: -1 | 1): void => {
    const header = def.headers[hi]
    const j = pi + dir
    if (j < 0 || j >= header.pins.length) return
    const pins = [...header.pins]
    ;[pins[pi], pins[j]] = [pins[j], pins[pi]]
    updateHeader(hi, { pins })
  }

  const addFeature = (): void => setFeatures([...(def.features ?? []), blankFeature()])
  const updateFeature = (fi: number, p: Partial<BoardFeature>): void =>
    setFeatures((def.features ?? []).map((f, i) => (i === fi ? { ...f, ...p } : f)))
  const removeFeature = (fi: number): void =>
    setFeatures((def.features ?? []).filter((_, i) => i !== fi))

  // --- Image upload (stored verbatim as a data URL → round-trips) -----------
  const onPickImage = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') patch({ image: reader.result })
    }
    reader.onerror = () => setStatus({ kind: 'error', text: 'Could not read that image.' })
    reader.readAsDataURL(file)
    // Allow re-selecting the same file later.
    e.target.value = ''
  }
  const removeImage = (): void => setDef((d) => ({ ...d, image: undefined }))

  // --- Persistence ----------------------------------------------------------
  const newBoard = (): void => {
    setDef(blankBoard())
    setOpenedId(null)
    setStatus({ kind: 'info', text: 'Started a new blank board.' })
  }

  const loadBoard = (id: string): void => {
    const found = userBoards.find((b) => b.id === id)
    if (!found) return
    // Normalise on load so older files gain the defaults (type:'gpio', etc.) —
    // this is the round-trip: saved JSON → editable working def.
    setDef(normaliseBoard(found))
    setOpenedId(found.id)
    setStatus({ kind: 'info', text: `Loaded "${found.name}" for editing.` })
  }

  const save = async (): Promise<void> => {
    const clean = normaliseBoard(def)
    const err = validateBoard(clean)
    if (err) {
      setStatus({ kind: 'error', text: err })
      return
    }
    if (idCollides(clean, userBoards, openedId)) {
      setStatus({
        kind: 'error',
        text: `A board with id "${clean.id}" already exists. Rename this one, or load it to edit.`
      })
      return
    }
    const res = await onSave(clean)
    if (res.ok) {
      setOpenedId(clean.id)
      setStatus({ kind: 'ok', text: `Saved "${clean.name}" (${clean.id}.json).` })
    } else {
      setStatus({ kind: 'error', text: res.error ?? 'Save failed.' })
    }
  }

  const deleteOpened = async (): Promise<void> => {
    if (!openedId) return
    if (!window.confirm(`Delete the saved board "${def.name}"? This cannot be undone.`)) return
    await onDelete(openedId)
    setStatus({ kind: 'info', text: `Deleted "${def.name}".` })
    newBoard()
  }

  // --- SVG export (ONE-WAY convenience; JSON stays the source of truth) ------
  const exportSvg = (): void => {
    const svg = previewHostRef.current?.querySelector('svg')
    if (!svg) {
      setStatus({ kind: 'error', text: 'Preview not ready to export yet.' })
      return
    }
    const clone = svg.cloneNode(true) as SVGSVGElement
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    const blob = new Blob([new XMLSerializer().serializeToString(clone)], {
      type: 'image/svg+xml'
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${fileId || 'board'}.svg`
    a.click()
    URL.revokeObjectURL(url)
    setStatus({ kind: 'info', text: 'Exported the preview as an .svg (JSON remains the editable source).' })
  }

  const ledOptions = useMemo(() => ledLabelOptions(def), [def])

  return (
    <div className={`bc ${asWindow ? 'bc--window' : ''}`} aria-label="Board Creator">
      <header className={`bc__bar ${asWindow ? 'bc__bar--drag' : ''}`}>
        <span className="bc__grip" aria-hidden="true">
          ⋮⋮
        </span>
        <span className="bc__title">BOARD CREATOR</span>
        <div className="bc__bar-actions">
          <button type="button" className="bc__btn" onClick={newBoard} title="Start a new blank board">
            New
          </button>
          <LoadMenu boards={userBoards} onLoad={loadBoard} />
          <button type="button" className="bc__btn bc__btn--primary" onClick={save} title="Save this board to disk">
            Save
          </button>
          <button type="button" className="bc__btn" onClick={exportSvg} title="Export the preview as an SVG file (one-way)">
            Export SVG
          </button>
          <button
            type="button"
            className="bc__btn bc__btn--danger"
            onClick={deleteOpened}
            disabled={!openedId}
            title={openedId ? 'Delete this saved board' : 'Save the board first to delete it'}
          >
            Delete
          </button>
          <button type="button" className="bc__btn" onClick={onDone} title="Back to the Board View">
            Done
          </button>
        </div>
      </header>

      {status && (
        <div className={`bc__status bc__status--${status.kind}`} role="status">
          {status.text}
        </div>
      )}

      <div className="bc__body">
        {/* --- Editing panels (scrollable) --- */}
        <div className="bc__panels">
          {/* Board meta */}
          <section className="bc__section">
            <h3 className="bc__h">Board</h3>
            <label className="bc__field">
              <span>Name</span>
              <input
                type="text"
                value={def.name}
                onChange={(e) => patch({ name: e.target.value, id: sanitiseBoardId(e.target.value) || def.id })}
                placeholder="My Board"
              />
            </label>
            <label className="bc__field">
              <span>Chip type (MCU)</span>
              <input
                type="text"
                value={def.mcu}
                onChange={(e) => patch({ mcu: e.target.value })}
                placeholder="RP2040"
              />
            </label>
            <div className="bc__row">
              <label className="bc__field">
                <span>PCB colour</span>
                <input
                  type="color"
                  value={/^#[0-9a-f]{6}$/i.test(def.pcbColor) ? def.pcbColor : '#0f5a2e'}
                  onChange={(e) => patch({ pcbColor: e.target.value })}
                />
              </label>
              <label className="bc__field">
                <span>Aspect (w/h)</span>
                <input
                  type="number"
                  step="0.01"
                  min="0.1"
                  value={def.aspect}
                  onChange={(e) => patch({ aspect: Number(e.target.value) || def.aspect })}
                />
              </label>
            </div>
            <label className="bc__field">
              <span>Onboard LED</span>
              <select
                value={def.ledLabel ?? ''}
                onChange={(e) => patch({ ledLabel: e.target.value || undefined })}
              >
                <option value="">None</option>
                {/* Always offer a generic "LED" token + every declared pad label. */}
                {!ledOptions.includes('LED') && <option value="LED">LED</option>}
                {ledOptions.map((lbl) => (
                  <option key={lbl} value={lbl}>
                    {lbl}
                  </option>
                ))}
              </select>
            </label>
            <p className="bc__hint">Saves as <code>{fileId || '—'}.json</code></p>
          </section>

          {/* Board representation: image OR drawn rectangles */}
          <section className="bc__section">
            <h3 className="bc__h">Board image</h3>
            <p className="bc__hint">
              Upload a photo/SVG to use as the board background, or leave it blank and draw
              rectangles below. The image is stored in the JSON, so it re-loads when you edit.
            </p>
            <div className="bc__row">
              <button type="button" className="bc__btn" onClick={() => fileInputRef.current?.click()}>
                Upload image…
              </button>
              {def.image && (
                <button type="button" className="bc__btn bc__btn--danger" onClick={removeImage}>
                  Remove image
                </button>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/svg+xml"
                style={{ display: 'none' }}
                onChange={onPickImage}
              />
            </div>
            {def.image && <p className="bc__hint">Image attached ({Math.round(def.image.length / 1024)} KB).</p>}
          </section>

          {/* Drawing tools: rectangle features */}
          <section className="bc__section">
            <h3 className="bc__h">
              Features (drawn rectangles)
              <button type="button" className="bc__add" onClick={addFeature} title="Add a rectangle">
                + Add
              </button>
            </h3>
            {(def.features ?? []).length === 0 && (
              <p className="bc__hint">No features. These are labelled rectangles (chip, USB, etc.).</p>
            )}
            {(def.features ?? []).map((f, fi) => (
              <div className="bc__item" key={fi}>
                <div className="bc__row">
                  <input
                    className="bc__grow"
                    type="text"
                    value={f.label}
                    onChange={(e) => updateFeature(fi, { label: e.target.value })}
                    placeholder="Label"
                  />
                  <select value={f.kind} onChange={(e) => updateFeature(fi, { kind: e.target.value as BoardFeature['kind'] })}>
                    {FEATURE_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </select>
                  <button type="button" className="bc__icon bc__icon--danger" onClick={() => removeFeature(fi)} title="Delete">
                    ✕
                  </button>
                </div>
                <div className="bc__xywh">
                  {(['x', 'y', 'w', 'h'] as const).map((k) => (
                    <label key={k} className="bc__num">
                      <span>{k}</span>
                      <input
                        type="number"
                        step="0.01"
                        value={f[k]}
                        onChange={(e) => updateFeature(fi, { [k]: Number(e.target.value) } as Partial<BoardFeature>)}
                      />
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </section>

          {/* Pin assignment tool: headers + pads */}
          <section className="bc__section">
            <h3 className="bc__h">
              Headers &amp; pins
              <button type="button" className="bc__add" onClick={addHeader} title="Add a header">
                + Add header
              </button>
            </h3>
            <p className="bc__hint">
              A header is a row of pads along one edge (left/right = vertical, top/bottom =
              horizontal). One pad = a single pin. Power pads (GND/VCC) are never wired.
            </p>
            {def.headers.map((h, hi) => (
              <div className="bc__header" key={hi}>
                <div className="bc__row bc__header-head">
                  <select value={h.edge} onChange={(e) => updateHeader(hi, { edge: e.target.value as BoardHeader['edge'] })}>
                    {HEADER_EDGES.map((edge) => (
                      <option key={edge} value={edge}>
                        {edge}
                      </option>
                    ))}
                  </select>
                  <span className="bc__count">{h.pins.length} pad{h.pins.length === 1 ? '' : 's'}</span>
                  <span className="bc__spacer" />
                  <button type="button" className="bc__icon" onClick={() => moveHeader(hi, -1)} disabled={hi === 0} title="Move up">
                    ↑
                  </button>
                  <button type="button" className="bc__icon" onClick={() => moveHeader(hi, 1)} disabled={hi === def.headers.length - 1} title="Move down">
                    ↓
                  </button>
                  <button type="button" className="bc__icon bc__icon--danger" onClick={() => removeHeader(hi)} title="Delete header">
                    ✕
                  </button>
                </div>
                {h.pins.map((pad, pi) => (
                  <div className="bc__pad" key={pi}>
                    <span className="bc__pad-n">{pi + 1}</span>
                    <select
                      className="bc__pad-type"
                      value={pad.type ?? 'gpio'}
                      onChange={(e) => updatePad(hi, pi, { type: e.target.value as BoardPadType })}
                      title="Pad type"
                    >
                      {PAD_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {PAD_TYPE_LABEL[t]}
                        </option>
                      ))}
                    </select>
                    <input
                      className="bc__pad-gpio"
                      type="number"
                      value={pad.gpio ?? ''}
                      placeholder="gpio"
                      disabled={(pad.type ?? 'gpio') !== 'gpio'}
                      onChange={(e) =>
                        updatePad(hi, pi, {
                          gpio: e.target.value === '' ? undefined : Number(e.target.value)
                        })
                      }
                      title="GPIO number (GPIO pads only)"
                    />
                    <input
                      className="bc__pad-label"
                      type="text"
                      value={pad.label}
                      placeholder="label (silk)"
                      onChange={(e) => updatePad(hi, pi, { label: e.target.value })}
                      title="Silk label"
                    />
                    <input
                      className="bc__pad-name"
                      type="text"
                      value={pad.name ?? ''}
                      placeholder="name"
                      onChange={(e) => updatePad(hi, pi, { name: e.target.value })}
                      title="Human pin name"
                    />
                    <button type="button" className="bc__icon" onClick={() => movePad(hi, pi, -1)} disabled={pi === 0} title="Move up">
                      ↑
                    </button>
                    <button type="button" className="bc__icon" onClick={() => movePad(hi, pi, 1)} disabled={pi === h.pins.length - 1} title="Move down">
                      ↓
                    </button>
                    <button type="button" className="bc__icon bc__icon--danger" onClick={() => removePad(hi, pi)} title="Delete pad">
                      ✕
                    </button>
                  </div>
                ))}
                <button type="button" className="bc__add bc__add--inline" onClick={() => addPad(hi)}>
                  + Add pad
                </button>
              </div>
            ))}
          </section>
        </div>

        {/* --- Live preview (same SVG drawing as the real view) --- */}
        <div className="bc__preview" ref={previewHostRef}>
          <BoardView source="" isPython={false} previewDef={normaliseBoard(def)} />
        </div>
      </div>
    </div>
  )
}

/** A tiny inline "Load existing" dropdown (avoids window.prompt). */
function LoadMenu({
  boards,
  onLoad
}: {
  boards: BoardDefinition[]
  onLoad: (id: string) => void
}): JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <div className="bc__load">
      <button
        type="button"
        className="bc__btn"
        onClick={() => setOpen((o) => !o)}
        disabled={boards.length === 0}
        title={boards.length === 0 ? 'No saved boards yet' : 'Load a saved board to edit'}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        Load ▾
      </button>
      {open && boards.length > 0 && (
        <>
          <button
            type="button"
            className="bc__load-backdrop"
            aria-hidden="true"
            tabIndex={-1}
            onClick={() => setOpen(false)}
          />
          <ul className="bc__load-menu" role="listbox" aria-label="Load a saved board">
            {boards.map((b) => (
              <li key={b.id} role="option" aria-selected={false}>
                <button
                  type="button"
                  className="bc__load-item"
                  onClick={() => {
                    onLoad(b.id)
                    setOpen(false)
                  }}
                >
                  <span className="bc__load-name">{b.name}</span>
                  <span className="bc__load-mcu">{b.mcu}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
