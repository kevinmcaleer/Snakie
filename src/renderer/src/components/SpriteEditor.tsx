import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent
} from 'react'
import { useHistory } from './use-history'
import { useInstrumentWorkspace } from '../store/workspace'
import {
  MAX_FPS,
  MAX_SIZE,
  MIN_FPS,
  MIN_SIZE,
  SIZE_PRESETS,
  addFrame,
  clampFps,
  clearFrame,
  deleteFrame,
  duplicateFrame,
  flipFrameH,
  flipFrameV,
  floodFill,
  invertFrame,
  moveFrame,
  newSprite,
  resizeSprite,
  safeStem,
  setFps,
  setPixel,
  shiftFrame,
  type SpriteDoc,
  type SpriteFrame
} from './sprite-model'
import {
  decodePbm,
  decodeSpr,
  docFromJson,
  docToJson,
  encodePbm,
  encodeSpr,
  sprToDoc
} from './sprite-codecs'
import { exportSpritePy, pyFilename } from './sprite-export'
import {
  decodeImageFile,
  encodeGif,
  encodeJpegFrame,
  encodePngFrame,
  encodePngSheet,
  mimeForFile,
  rasterToSprite
} from './sprite-image-io'
import { seedSprite } from './sprite-seed'
import './SpriteEditor.css'

/**
 * SPRITE EDITOR — draw 1-bit sprites + frame animations for LED matrices and
 * OLEDs, launched from the Display instrument's SPRITES key.
 * =============================================================================
 *
 * A full-screen overlay (the Part Editor pattern: `role="dialog"`, Soft Shell
 * tokens) around a pure model: ALL document logic lives in `sprite-model.ts` /
 * `sprite-codecs.ts` / `sprite-export.ts` / `sprite-image-io.ts`; this file is
 * the surface — canvas painting, the filmstrip, playback, and the save/import/
 * export hand-offs through `window.api.fs`.
 *
 * Formats (see `sprite-codecs.ts` for the whys):
 *  - `.spr` — the Snakie animation container (16-byte SNKS header + MONO_HLSB
 *    frames), the on-device format.
 *  - `.pbm` — single-frame interchange; P4's raster IS MONO_HLSB.
 *  - PNG / JPEG / GIF — desktop interchange via the canvas + `gifenc`; animated
 *    GIFs import with per-frame timings, and integer-upscaled pixel art is
 *    folded back to its true grid.
 *  - `.py` — a ready-to-import MicroPython module, opened as an editor buffer.
 */

/** Where the working sprite is parked so closing the overlay can't lose it. */
const DRAFT_KEY = 'snakie.sprite.draft.v1'

/** Painting tools. */
type Tool = 'draw' | 'erase' | 'fill'

/** Export formats offered by the EXPORT picker. */
const EXPORT_FORMATS = [
  { id: 'spr', label: 'Animation (.spr)', scaled: false },
  { id: 'py', label: 'MicroPython module (.py)', scaled: false },
  { id: 'gif', label: 'Animated GIF (.gif)', scaled: true },
  { id: 'png', label: 'PNG — this frame (.png)', scaled: true },
  { id: 'png-sheet', label: 'PNG sprite sheet (.png)', scaled: true },
  { id: 'jpeg', label: 'JPEG — this frame (.jpg)', scaled: true },
  { id: 'pbm', label: 'PBM — this frame (.pbm)', scaled: false },
  { id: 'pbm-all', label: 'PBM — every frame (.pbm)', scaled: false }
] as const
type ExportFormat = (typeof EXPORT_FORMATS)[number]['id']

/** Integer pixel scales offered for the image exports. */
const EXPORT_SCALES = [1, 4, 8, 16] as const

/** Read the parked draft, falling back to the bundled blinking-eyes starter. */
function loadDraft(): SpriteDoc {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY)
    if (raw) {
      const doc = docFromJson(JSON.parse(raw))
      if (doc) return doc
    }
  } catch {
    /* storage off / corrupt draft — fall through to the seed */
  }
  return seedSprite()
}

/** Park the working sprite (best-effort — storage may be off). */
function saveDraft(doc: SpriteDoc): void {
  try {
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify(docToJson(doc)))
  } catch {
    /* ignore */
  }
}

/** A CSS custom-property token's live value, with a fallback for tests. */
function cssToken(name: string, fallback: string): string {
  try {
    const v = window.getComputedStyle(document.documentElement).getPropertyValue(name).trim()
    return v || fallback
  } catch {
    return fallback
  }
}

export interface SpriteEditorProps {
  onClose: () => void
}

export function SpriteEditor({ onClose }: SpriteEditorProps): JSX.Element {
  const { openBuffer } = useInstrumentWorkspace()
  // The parked draft is read ONCE (lazy useState) — useHistory takes a value.
  const [initialDoc] = useState<SpriteDoc>(loadDraft)
  const { state: doc, set: setDoc, undo, redo, reset, canUndo, canRedo } = useHistory<SpriteDoc>(
    initialDoc,
    { coalesceMs: 350 }
  )
  const [selected, setSelected] = useState(0)
  const [tool, setTool] = useState<Tool>('draw')
  const [onion, setOnion] = useState(true)
  const [playing, setPlaying] = useState(false)
  const [playFrame, setPlayFrame] = useState(0)
  const [format, setFormat] = useState<ExportFormat>('spr')
  const [scale, setScale] = useState<number>(8)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  // Park the draft, debounced — a drag produces a state change per pixel.
  useEffect(() => {
    const t = window.setTimeout(() => saveDraft(doc), 400)
    return () => window.clearTimeout(t)
  }, [doc])

  // Keep the selection on a frame that exists (deletes clamp it back in).
  const frameCount = doc.frames.length
  useEffect(() => {
    if (selected >= frameCount) setSelected(frameCount - 1)
  }, [selected, frameCount])

  const flash = useCallback((message: string) => {
    setNote(message)
    window.setTimeout(() => setNote((n) => (n === message ? null : n)), 3200)
  }, [])

  // ── Playback ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!playing) return
    setPlayFrame(selected)
    const t = window.setInterval(
      () => setPlayFrame((f) => (f + 1) % Math.max(1, frameCount)),
      Math.max(20, Math.round(1000 / doc.fps))
    )
    return () => window.clearInterval(t)
    // Restart the clock when the rate or frame count changes.
  }, [playing, doc.fps, frameCount]) // eslint-disable-line react-hooks/exhaustive-deps

  const shownIndex = playing ? Math.min(playFrame, frameCount - 1) : selected
  const shownFrame = doc.frames[shownIndex]

  // ── Canvas painting ───────────────────────────────────────────────────────
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  // The paint gesture: the value being painted (draw decides it from the first
  // cell so a sweep can't flicker), or null when no drag is live.
  const painting = useRef<boolean | null>(null)
  const lastCell = useRef<{ x: number; y: number } | null>(null)

  // Cell size: fill a sensible stage without overflowing (4–30 px per pixel).
  const cell = Math.max(4, Math.min(30, Math.floor(600 / Math.max(doc.width, doc.height))))

  // Redraw the grid whenever the document, selection, playback or skin changes.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !shownFrame) return
    const dpr = window.devicePixelRatio || 1
    const w = doc.width * cell
    const h = doc.height * cell
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
    canvas.style.width = `${w}px`
    canvas.style.height = `${h}px`
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const lit = cssToken('--gold', '#d9a441')
    ctx.fillStyle = '#101216'
    ctx.fillRect(0, 0, w, h)
    // Onion skin: the previous frame, faint, under the live pixels.
    if (onion && !playing && frameCount > 1) {
      const prev = doc.frames[(shownIndex + frameCount - 1) % frameCount]
      ctx.fillStyle = 'rgba(160, 170, 200, 0.22)'
      for (let y = 0; y < doc.height; y++) {
        for (let x = 0; x < doc.width; x++) {
          if (prev.pixels[y][x]) ctx.fillRect(x * cell + 1, y * cell + 1, cell - 2, cell - 2)
        }
      }
    }
    ctx.fillStyle = lit
    for (let y = 0; y < doc.height; y++) {
      for (let x = 0; x < doc.width; x++) {
        if (shownFrame.pixels[y][x]) {
          ctx.fillRect(x * cell + 1, y * cell + 1, cell - 2, cell - 2)
        }
      }
    }
    // The pixel lattice on top (skipped at tiny cells where it would swamp).
    if (cell >= 6) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)'
      ctx.lineWidth = 1
      ctx.beginPath()
      for (let x = 0; x <= doc.width; x++) {
        ctx.moveTo(x * cell + 0.5, 0)
        ctx.lineTo(x * cell + 0.5, h)
      }
      for (let y = 0; y <= doc.height; y++) {
        ctx.moveTo(0, y * cell + 0.5)
        ctx.lineTo(w, y * cell + 0.5)
      }
      ctx.stroke()
    }
  }, [doc, shownFrame, shownIndex, cell, onion, playing, frameCount])

  const cellAt = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>): { x: number; y: number } | null => {
      const rect = e.currentTarget.getBoundingClientRect()
      const x = Math.floor((e.clientX - rect.left) / cell)
      const y = Math.floor((e.clientY - rect.top) / cell)
      if (x < 0 || y < 0 || x >= doc.width || y >= doc.height) return null
      return { x, y }
    },
    [cell, doc.width, doc.height]
  )

  const onCanvasDown = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>): void => {
      e.preventDefault()
      if (playing) {
        setPlaying(false)
        return
      }
      const at = cellAt(e)
      if (!at) return
      if (tool === 'fill') {
        setDoc((d) => floodFill(d, selected, at.x, at.y, !d.frames[selected].pixels[at.y][at.x]))
        return
      }
      const value = tool === 'erase' ? false : !doc.frames[selected].pixels[at.y][at.x]
      painting.current = value
      lastCell.current = at
      e.currentTarget.setPointerCapture?.(e.pointerId)
      setDoc((d) => setPixel(d, selected, at.x, at.y, value))
    },
    [playing, cellAt, tool, doc.frames, selected, setDoc]
  )

  const onCanvasMove = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>): void => {
      if (painting.current === null) return
      const at = cellAt(e)
      if (!at || (lastCell.current && at.x === lastCell.current.x && at.y === lastCell.current.y)) {
        return
      }
      lastCell.current = at
      const value = painting.current
      setDoc((d) => setPixel(d, selected, at.x, at.y, value))
    },
    [cellAt, selected, setDoc]
  )

  useEffect(() => {
    const stop = (): void => {
      painting.current = null
      lastCell.current = null
    }
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
    return () => {
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
    }
  }, [])

  // ── Keyboard: undo/redo, play, close ──────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null
      const typing =
        target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        redo()
      } else if (e.key === ' ' && !typing) {
        e.preventDefault()
        setPlaying((p) => !p)
      } else if (e.key === 'Escape' && !typing) {
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo, onClose])

  // ── Size / rate edits ─────────────────────────────────────────────────────
  const presetValue = useMemo(() => {
    const hit = SIZE_PRESETS.find((p) => p.w === doc.width && p.h === doc.height)
    return hit ? `${hit.w}x${hit.h}` : 'custom'
  }, [doc.width, doc.height])

  const onPreset = useCallback(
    (value: string): void => {
      const [w, h] = value.split('x').map(Number)
      if (Number.isInteger(w) && Number.isInteger(h)) setDoc((d) => resizeSprite(d, w, h))
    },
    [setDoc]
  )

  // ── Import ────────────────────────────────────────────────────────────────
  const onImport = useCallback(async (): Promise<void> => {
    setBusy(true)
    try {
      const path = await window.api.fs.openFileDialog({
        filters: [
          { name: 'Sprites & images', extensions: ['spr', 'pbm', 'png', 'jpg', 'jpeg', 'gif'] }
        ]
      })
      if (!path) return
      const name = path.split(/[/\\]/).pop() ?? 'sprite'
      const stem = name.replace(/\.[^.]+$/, '')
      const bytes = await window.api.fs.readFileBytes(path)
      const ext = name.toLowerCase().split('.').pop() ?? ''
      let next: SpriteDoc
      if (ext === 'spr') {
        next = sprToDoc(stem, decodeSpr(bytes))
      } else if (ext === 'pbm') {
        const { width, height, frame } = decodePbm(bytes)
        next = { name: stem, width, height, depth: 1, fps: doc.fps, frames: [frame] }
      } else {
        const mime = mimeForFile(name)
        if (!mime) throw new Error(`Unsupported file type ".${ext}".`)
        const raster = rasterToSprite(await decodeImageFile(bytes, mime))
        const avg = raster.durations.reduce((a, b) => a + b, 0) / raster.durations.length
        next = {
          name: stem,
          width: raster.width,
          height: raster.height,
          depth: 1,
          fps:
            raster.frames.length > 1 ? clampFps(Math.round(1000 / Math.max(1, avg))) : doc.fps,
          frames: raster.frames
        }
      }
      reset(next)
      setSelected(0)
      setPlaying(false)
      flash(
        `Imported ${next.frames.length} frame${next.frames.length === 1 ? '' : 's'} (${next.width}×${next.height}) from ${name}.`
      )
    } catch (err) {
      flash(err instanceof Error ? err.message : 'Import failed.')
    } finally {
      setBusy(false)
    }
  }, [doc.fps, reset, flash])

  // ── Export / save ─────────────────────────────────────────────────────────
  const stem = safeStem(doc.name)

  /** Save-dialog + binary write helper shared by every file export. */
  const writeOut = useCallback(
    async (defaultName: string, filterName: string, exts: string[], bytes: Uint8Array): Promise<string | null> => {
      const path = await window.api.fs.saveFileDialog(defaultName, {
        filters: [{ name: filterName, extensions: exts }]
      })
      if (!path) return null
      await window.api.fs.writeFileBytes(path, bytes)
      return path
    },
    []
  )

  const onExport = useCallback(async (): Promise<void> => {
    setBusy(true)
    try {
      if (format === 'py') {
        openBuffer(pyFilename(doc), exportSpritePy(doc))
        flash(`Opened ${pyFilename(doc)} in the editor — save it to your project or the board.`)
        return
      }
      if (format === 'spr') {
        const path = await writeOut(`${stem}.spr`, 'Snakie sprite', ['spr'], encodeSpr(doc))
        if (path) flash(`Saved ${doc.frames.length} frame${doc.frames.length === 1 ? '' : 's'} to ${path}.`)
        return
      }
      if (format === 'pbm') {
        const path = await writeOut(
          `${stem}.pbm`,
          'Portable bitmap',
          ['pbm'],
          encodePbm(doc.frames[selected], doc.width, doc.height)
        )
        if (path) flash(`Saved frame ${selected + 1} to ${path}.`)
        return
      }
      if (format === 'pbm-all') {
        const path = await window.api.fs.saveFileDialog(`${stem}.pbm`, {
          filters: [{ name: 'Portable bitmap', extensions: ['pbm'] }]
        })
        if (!path) return
        const base = path.replace(/\.pbm$/i, '')
        for (let i = 0; i < doc.frames.length; i++) {
          const suffix = doc.frames.length === 1 ? '' : `-${String(i + 1).padStart(2, '0')}`
          await window.api.fs.writeFileBytes(
            `${base}${suffix}.pbm`,
            encodePbm(doc.frames[i], doc.width, doc.height)
          )
        }
        flash(`Saved ${doc.frames.length} PBM frame${doc.frames.length === 1 ? '' : 's'} beside ${path}.`)
        return
      }
      if (format === 'gif') {
        const path = await writeOut(`${stem}.gif`, 'Animated GIF', ['gif'], encodeGif(doc, scale))
        if (path) flash(`Saved a looping GIF (${scale}× scale) to ${path}.`)
        return
      }
      if (format === 'png') {
        const path = await writeOut(
          `${stem}.png`,
          'PNG image',
          ['png'],
          await encodePngFrame(doc, selected, scale)
        )
        if (path) flash(`Saved frame ${selected + 1} (${scale}× scale) to ${path}.`)
        return
      }
      if (format === 'png-sheet') {
        const path = await writeOut(
          `${stem}-sheet.png`,
          'PNG image',
          ['png'],
          await encodePngSheet(doc, scale)
        )
        if (path) flash(`Saved a ${doc.frames.length}-frame sheet (${scale}× scale) to ${path}.`)
        return
      }
      const path = await writeOut(
        `${stem}.jpg`,
        'JPEG image',
        ['jpg', 'jpeg'],
        await encodeJpegFrame(doc, selected, scale)
      )
      if (path) flash(`Saved frame ${selected + 1} (${scale}× scale) to ${path}.`)
    } catch (err) {
      flash(err instanceof Error ? err.message : 'Export failed.')
    } finally {
      setBusy(false)
    }
  }, [format, doc, selected, scale, stem, writeOut, openBuffer, flash])

  const onSave = useCallback(async (): Promise<void> => {
    setBusy(true)
    try {
      const path = await writeOut(`${stem}.spr`, 'Snakie sprite', ['spr'], encodeSpr(doc))
      if (path) flash(`Saved ${doc.frames.length} frame${doc.frames.length === 1 ? '' : 's'} to ${path}.`)
    } catch (err) {
      flash(err instanceof Error ? err.message : 'Save failed.')
    } finally {
      setBusy(false)
    }
  }, [doc, stem, writeOut, flash])

  const onNew = useCallback((): void => {
    if (window.confirm('Start a new blank sprite? This clears the current drawing.')) {
      reset(newSprite('sprite', doc.width, doc.height, doc.fps))
      setSelected(0)
      setPlaying(false)
    }
  }, [reset, doc])

  const scaled = EXPORT_FORMATS.find((f) => f.id === format)?.scaled ?? false

  return (
    <div className="spred" role="dialog" aria-modal="true" aria-label="Sprite Editor">
      {/* ── Title bar ─────────────────────────────────────────────────────── */}
      <div className="spred__bar">
        <span className="spred__title">SPRITE EDITOR</span>
        <label className="spred__field spred__field--name">
          <span>NAME</span>
          <input
            type="text"
            value={doc.name}
            spellCheck={false}
            onChange={(e) => setDoc((d) => ({ ...d, name: e.target.value }))}
            aria-label="Sprite name"
          />
        </label>
        <label className="spred__field">
          <span>W</span>
          <input
            type="number"
            min={MIN_SIZE}
            max={MAX_SIZE}
            value={doc.width}
            onChange={(e) => setDoc((d) => resizeSprite(d, Number(e.target.value), d.height))}
            aria-label="Sprite width in pixels"
          />
        </label>
        <label className="spred__field">
          <span>H</span>
          <input
            type="number"
            min={MIN_SIZE}
            max={MAX_SIZE}
            value={doc.height}
            onChange={(e) => setDoc((d) => resizeSprite(d, d.width, Number(e.target.value)))}
            aria-label="Sprite height in pixels"
          />
        </label>
        <label className="spred__field spred__field--preset">
          <span>SIZE</span>
          <select value={presetValue} onChange={(e) => onPreset(e.target.value)} aria-label="Size preset">
            {presetValue === 'custom' && <option value="custom">Custom ({doc.width}×{doc.height})</option>}
            {SIZE_PRESETS.map((p) => (
              <option key={p.label} value={`${p.w}x${p.h}`}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className="spred__field">
          <span>FPS</span>
          <input
            type="number"
            min={MIN_FPS}
            max={MAX_FPS}
            value={doc.fps}
            onChange={(e) => setDoc((d) => setFps(d, Number(e.target.value)))}
            aria-label="Playback frames per second"
          />
        </label>
        <span className="spred__spacer" />
        <button type="button" className="spred__btn" onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)">
          ↶
        </button>
        <button type="button" className="spred__btn" onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)">
          ↷
        </button>
        <button type="button" className="spred__btn" onClick={onNew} disabled={busy} title="Start a blank sprite">
          New
        </button>
        <button type="button" className="spred__btn" onClick={() => void onImport()} disabled={busy}>
          Import…
        </button>
        <label className="spred__field spred__field--export">
          <span>EXPORT</span>
          <select
            value={format}
            onChange={(e) => setFormat(e.target.value as ExportFormat)}
            aria-label="Export format"
          >
            {EXPORT_FORMATS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        {scaled && (
          <label className="spred__field">
            <span>SCALE</span>
            <select value={scale} onChange={(e) => setScale(Number(e.target.value))} aria-label="Export pixel scale">
              {EXPORT_SCALES.map((s) => (
                <option key={s} value={s}>
                  {s}×
                </option>
              ))}
            </select>
          </label>
        )}
        <button type="button" className="spred__btn" onClick={() => void onExport()} disabled={busy}>
          Export
        </button>
        <button
          type="button"
          className="spred__btn spred__btn--primary"
          onClick={() => void onSave()}
          disabled={busy}
          title="Save the animation as a .spr file"
        >
          Save .spr
        </button>
        <button type="button" className="spred__btn spred__btn--close" onClick={onClose} title="Close (Esc)">
          ✕
        </button>
      </div>

      {/* ── Status strip ──────────────────────────────────────────────────── */}
      {note && (
        <div className="spred__status" role="status">
          {note}
        </div>
      )}

      {/* ── Body: tools rail · canvas stage ───────────────────────────────── */}
      <div className="spred__body">
        <div className="spred__tools" role="toolbar" aria-label="Drawing tools">
          <ToolKey label="✏" title="Draw (click toggles, drag paints)" on={tool === 'draw'} onClick={() => setTool('draw')} />
          <ToolKey label="⌫" title="Erase" on={tool === 'erase'} onClick={() => setTool('erase')} />
          <ToolKey label="◍" title="Fill (flood)" on={tool === 'fill'} onClick={() => setTool('fill')} />
          <span className="spred__tools-gap" />
          <ToolKey label="↑" title="Nudge frame up" onClick={() => setDoc((d) => shiftFrame(d, selected, 0, -1))} />
          <ToolKey label="↓" title="Nudge frame down" onClick={() => setDoc((d) => shiftFrame(d, selected, 0, 1))} />
          <ToolKey label="←" title="Nudge frame left" onClick={() => setDoc((d) => shiftFrame(d, selected, -1, 0))} />
          <ToolKey label="→" title="Nudge frame right" onClick={() => setDoc((d) => shiftFrame(d, selected, 1, 0))} />
          <span className="spred__tools-gap" />
          <ToolKey label="⇋" title="Flip horizontally" onClick={() => setDoc((d) => flipFrameH(d, selected))} />
          <ToolKey label="⇵" title="Flip vertically" onClick={() => setDoc((d) => flipFrameV(d, selected))} />
          <ToolKey label="◑" title="Invert frame" onClick={() => setDoc((d) => invertFrame(d, selected))} />
          <ToolKey label="⌧" title="Clear frame" onClick={() => setDoc((d) => clearFrame(d, selected))} />
          <span className="spred__tools-gap" />
          <ToolKey label="👁" title="Onion skin (previous frame)" on={onion} onClick={() => setOnion((o) => !o)} />
        </div>

        <div className="spred__stage">
          <canvas
            ref={canvasRef}
            className="spred__canvas"
            onPointerDown={onCanvasDown}
            onPointerMove={onCanvasMove}
            aria-label={`Sprite drawing grid, ${doc.width} by ${doc.height} pixels, frame ${shownIndex + 1} of ${frameCount}`}
          />
          <div className="spred__stage-meta">
            {doc.width}×{doc.height} · frame {shownIndex + 1}/{frameCount}
            {playing ? ` · playing at ${doc.fps} fps` : ''}
          </div>
        </div>
      </div>

      {/* ── Filmstrip + transport ─────────────────────────────────────────── */}
      <div className="spred__strip-row">
        <button
          type="button"
          className={`spred__btn spred__btn--play${playing ? ' spred__btn--on' : ''}`}
          onClick={() => setPlaying((p) => !p)}
          title="Play / stop (Space)"
        >
          {playing ? '■' : '▶'}
        </button>
        <div className="spred__strip" role="listbox" aria-label="Animation frames">
          {doc.frames.map((frame, i) => (
            <FrameThumb
              key={i}
              frame={frame}
              width={doc.width}
              height={doc.height}
              index={i}
              selected={i === (playing ? shownIndex : selected)}
              onSelect={() => {
                setSelected(i)
                setPlaying(false)
              }}
            />
          ))}
          <button
            type="button"
            className="spred__thumb spred__thumb--add"
            onClick={() => {
              setDoc((d) => addFrame(d, selected))
              setSelected((s) => Math.min(s + 1, frameCount))
            }}
            title="Add a blank frame after this one"
          >
            +
          </button>
        </div>
        <div className="spred__frame-ops">
          <button
            type="button"
            className="spred__btn"
            onClick={() => {
              setDoc((d) => duplicateFrame(d, selected))
              setSelected((s) => s + 1)
            }}
            title="Duplicate this frame"
          >
            Duplicate
          </button>
          <button
            type="button"
            className="spred__btn"
            onClick={() => setDoc((d) => moveFrame(d, selected, selected - 1))}
            disabled={selected === 0}
            title="Move this frame earlier"
          >
            ◀
          </button>
          <button
            type="button"
            className="spred__btn"
            onClick={() => setDoc((d) => moveFrame(d, selected, selected + 1))}
            disabled={selected >= frameCount - 1}
            title="Move this frame later"
          >
            ▶
          </button>
          <button
            type="button"
            className="spred__btn spred__btn--danger"
            onClick={() => setDoc((d) => deleteFrame(d, selected))}
            title="Delete this frame"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}

/** One square tool key in the left rail. */
function ToolKey({
  label,
  title,
  on,
  onClick
}: {
  label: string
  title: string
  on?: boolean
  onClick: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      className={`spred__tool${on ? ' spred__tool--on' : ''}`}
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={on}
    >
      {label}
    </button>
  )
}

/** One filmstrip thumbnail — the frame drawn small on its own canvas. */
function FrameThumb({
  frame,
  width,
  height,
  index,
  selected,
  onSelect
}: {
  frame: SpriteFrame
  width: number
  height: number
  index: number
  selected: boolean
  onSelect: () => void
}): JSX.Element {
  const ref = useRef<HTMLCanvasElement | null>(null)
  const cell = Math.max(1, Math.floor(48 / Math.max(width, height)))
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    canvas.width = width * cell
    canvas.height = height * cell
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.fillStyle = '#101216'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = cssToken('--gold', '#d9a441')
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (frame.pixels[y][x]) ctx.fillRect(x * cell, y * cell, cell, cell)
      }
    }
  }, [frame, width, height, cell])
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      className={`spred__thumb${selected ? ' spred__thumb--on' : ''}`}
      onClick={onSelect}
      title={`Frame ${index + 1}`}
    >
      <canvas ref={ref} className="spred__thumb-px" />
      <span className="spred__thumb-n">{index + 1}</span>
    </button>
  )
}
