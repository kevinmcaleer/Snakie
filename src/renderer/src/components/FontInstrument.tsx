import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent
} from 'react'
import { InstrumentWindow, type FloatProps } from './InstrumentWindow'
import { type InstrumentDef } from './instruments-registry'
import { useInstrumentWorkspace } from '../store/workspace'
import {
  CHARSETS,
  MAX_CELL,
  MIN_CELL,
  SAMPLE_TEXT,
  autoFitAll,
  autoWidth,
  charsetById,
  clearGlyph,
  codeLabel,
  copyGlyph,
  drawnCount,
  fromFontJson,
  glyphAt,
  glyphHasInk,
  invertGlyph,
  measureText,
  renderText,
  resizeFont,
  setBaseline,
  setCharset,
  setGlyphWidth,
  setMonospaced,
  setPixel,
  shiftGlyph,
  toFontJson,
  type BitmapFont
} from './font-model'
import { seedFont } from './font-seed'
import {
  FONT_EXPORT_FORMATS,
  exportFont,
  exportFilename,
  type FontExportFormat
} from './font-export'
import './FontInstrument.css'

/**
 * FONT EDITOR (#250) — design bitmap fonts for MicroPython displays.
 * =============================================================================
 *
 * The drawing half of Snakie's asset studio: a per-glyph pixel grid, a
 * charset navigator across the whole font, an adjustable cell (fixed or
 * proportional), and a 1× preview line so you can see what a sentence actually
 * looks like before you flash it.
 *
 * **All the thinking lives in `font-model.ts` / `font-export.ts`** — both pure
 * and DOM-free. This file is the surface: pointer handling, layout, and the
 * export hand-off into the editor. The export writes a `font-to-py`-compatible
 * module, so existing `Writer` code keeps working (see `font-export.ts` for what
 * was verified against the reference implementation).
 *
 * Deliberately NOT here yet (follow-ups on #250): importing an existing font
 * module to edit, uploading to the board, and a live preview on real hardware.
 */

/** Where the working font is parked so a panel close doesn't lose the drawing. */
const DRAFT_KEY = 'snakie.font.draft'

/** Read the parked draft, falling back to the bundled starter font. */
function loadDraft(): BitmapFont {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY)
    if (raw) {
      const font = fromFontJson(JSON.parse(raw))
      if (font) return font
    }
  } catch {
    /* corrupt / unavailable storage just means "start from the starter font" */
  }
  return seedFont()
}

/** Park the working font (best-effort — a full quota is not worth an error). */
function saveDraft(font: BitmapFont): void {
  try {
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify(toFontJson(font)))
  } catch {
    /* ignore */
  }
}

/** The charset id whose codes exactly match the font's, or `''` for a custom set. */
function matchCharset(font: BitmapFont): string {
  const codes = font.glyphs.map((g) => g.code).join(',')
  return CHARSETS.find((c) => c.codes.join(',') === codes)?.id ?? ''
}

export interface FontInstrumentProps {
  def: InstrumentDef
  onClose?: () => void
  docked?: boolean
  onToggleDock?: () => void
  float?: FloatProps
}

export function FontInstrument({
  def,
  onClose,
  docked = true,
  onToggleDock,
  float
}: FontInstrumentProps): JSX.Element {
  const { openBuffer } = useInstrumentWorkspace()
  const [font, setFont] = useState<BitmapFont>(loadDraft)
  const [selected, setSelected] = useState(0x41)
  const [format, setFormat] = useState<FontExportFormat>('font-to-py')
  const [preview, setPreview] = useState(SAMPLE_TEXT)
  const [note, setNote] = useState<string | null>(null)

  // Park the working font so closing the panel (or the app) doesn't lose it.
  // Debounced: a drag across the grid produces a state change per pixel, and
  // re-serialising the whole font on each one is pure waste.
  useEffect(() => {
    const t = window.setTimeout(() => saveDraft(font), 400)
    return () => window.clearTimeout(t)
  }, [font])

  // Keep the selection on a code point the font actually has.
  const glyph = glyphAt(font, selected)
  useEffect(() => {
    if (!glyph && font.glyphs.length) setSelected(font.glyphs[0].code)
  }, [glyph, font.glyphs])

  // ── Drawing ───────────────────────────────────────────────────────────────
  // A drag paints one VALUE (set or clear, decided by the first cell touched) so
  // sweeping across the grid can't flicker pixels on and off under the pointer.
  const painting = useRef<boolean | null>(null)
  const paint = useCallback(
    (x: number, y: number, value: boolean) => {
      setFont((f) => setPixel(f, selected, x, y, value))
    },
    [selected]
  )
  const onCellDown = useCallback(
    (e: ReactPointerEvent<HTMLButtonElement>, x: number, y: number, lit: boolean) => {
      e.preventDefault()
      // Touch/pen input is IMPLICITLY pointer-captured to the cell that was
      // pressed, which would stop `pointerenter` firing on its neighbours and
      // reduce the drag to a single pixel. Release it so the sweep works.
      if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId)
      }
      const value = !lit
      painting.current = value
      paint(x, y, value)
    },
    [paint]
  )
  const onCellEnter = useCallback(
    (x: number, y: number) => {
      if (painting.current !== null) paint(x, y, painting.current)
    },
    [paint]
  )
  useEffect(() => {
    const stop = (): void => {
      painting.current = null
    }
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
    return () => {
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
    }
  }, [])

  // ── Derived ───────────────────────────────────────────────────────────────
  const drawn = useMemo(() => drawnCount(font), [font])
  const previewGrid = useMemo(() => renderText(font, preview), [font, preview])
  const charsetId = useMemo(() => matchCharset(font), [font])
  // Scale the editing grid to fill the window width without overflowing it.
  const cellPx = Math.max(6, Math.min(26, Math.floor(232 / Math.max(1, font.width))))

  const flash = useCallback((message: string) => {
    setNote(message)
    window.setTimeout(() => setNote((n) => (n === message ? null : n)), 2600)
  }, [])

  const onExport = useCallback(() => {
    const { filename, source } = exportFont(font, format)
    openBuffer(filename, source)
    flash(`Opened ${filename} in the editor.`)
  }, [font, format, openBuffer, flash])

  const onPickCharset = useCallback(
    (id: string) => {
      const codes = charsetById(id).codes
      const lost = font.glyphs.filter((g) => glyphHasInk(g) && !codes.includes(g.code)).length
      if (
        lost > 0 &&
        !window.confirm(`That charset drops ${lost} drawn glyph${lost === 1 ? '' : 's'}. Continue?`)
      ) {
        return
      }
      setFont((f) => setCharset(f, codes))
    },
    [font.glyphs]
  )

  const onReset = useCallback(() => {
    if (window.confirm('Replace the current font with the bundled 5×8 starter font?')) {
      setFont(seedFont(font.name))
      flash('Reset to the starter font.')
    }
  }, [font.name, flash])

  const accentStyle = {
    '--accent': def.accent,
    '--accent-border': def.border
  } as CSSProperties

  return (
    <InstrumentWindow
      name={def.name.toUpperCase()}
      helpId={`inst-${def.id}`}
      source={`${font.width}×${font.height} · ${drawn}/${font.glyphs.length}`}
      docked={docked}
      onClose={onClose}
      onToggleDock={onToggleDock}
      {...float}
    >
      <div className="glyf" style={accentStyle}>
        {/* ── The font's own metrics ─────────────────────────────────────── */}
        <div className="glyf__metrics">
          <label className="glyf__field glyf__field--name">
            <span>NAME</span>
            <input
              type="text"
              value={font.name}
              spellCheck={false}
              onChange={(e) => setFont((f) => ({ ...f, name: e.target.value }))}
              aria-label="Font name"
            />
          </label>
          <label className="glyf__field">
            <span>W</span>
            <input
              type="number"
              min={MIN_CELL}
              max={MAX_CELL}
              value={font.width}
              onChange={(e) => setFont((f) => resizeFont(f, Number(e.target.value), f.height))}
              aria-label="Cell width"
            />
          </label>
          <label className="glyf__field">
            <span>H</span>
            <input
              type="number"
              min={MIN_CELL}
              max={MAX_CELL}
              value={font.height}
              onChange={(e) => setFont((f) => resizeFont(f, f.width, Number(e.target.value)))}
              aria-label="Cell height"
            />
          </label>
          <label className="glyf__field">
            <span>BASE</span>
            <input
              type="number"
              min={0}
              max={font.height}
              value={font.baseline}
              onChange={(e) => setFont((f) => setBaseline(f, Number(e.target.value)))}
              aria-label="Baseline, rows from the top"
            />
          </label>
        </div>

        <div className="glyf__metrics">
          <label className="glyf__field glyf__field--grow">
            <span>CHARSET</span>
            <select
              value={charsetId}
              onChange={(e) => onPickCharset(e.target.value)}
              aria-label="Character set"
            >
              {!charsetId && <option value="">Custom ({font.glyphs.length})</option>}
              {CHARSETS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label className="glyf__check" title="Fixed pitch — every glyph is the cell width">
            <input
              type="checkbox"
              checked={font.monospaced}
              onChange={(e) => setFont((f) => setMonospaced(f, e.target.checked))}
            />
            <span>MONO</span>
          </label>
          <button
            type="button"
            className="glyf__btn"
            disabled={font.monospaced}
            onClick={() => setFont((f) => autoFitAll(f, 1))}
            title="Make the font proportional: shrink every glyph to its ink + 1px of spacing"
          >
            Auto-fit
          </button>
        </div>

        {/* ── Charset navigator ──────────────────────────────────────────── */}
        <div className="glyf__nav" role="listbox" aria-label="Character set">
          {font.glyphs.map((g) => (
            <button
              key={g.code}
              type="button"
              role="option"
              aria-selected={g.code === selected}
              className={`glyf__cell${g.code === selected ? ' glyf__cell--on' : ''}${
                glyphHasInk(g) ? ' glyf__cell--ink' : ''
              }`}
              title={`U+${g.code.toString(16).toUpperCase().padStart(4, '0')} · ${g.width}px wide`}
              onClick={() => setSelected(g.code)}
            >
              {codeLabel(g.code)}
            </button>
          ))}
        </div>

        {/* ── The glyph grid ─────────────────────────────────────────────── */}
        {glyph && (
          <div className="glyf__editor">
            <div
              className="glyf__grid"
              style={{ '--cols': glyph.width, '--px': `${cellPx}px` } as CSSProperties}
              onPointerUp={() => {
                painting.current = null
              }}
            >
              {glyph.rows.map((row, y) =>
                row.map((lit, x) => (
                  <button
                    key={`${x},${y}`}
                    type="button"
                    className={`glyf__px${lit ? ' glyf__px--on' : ''}${
                      y === font.baseline - 1 ? ' glyf__px--base' : ''
                    }`}
                    aria-label={`Pixel ${x}, ${y}${lit ? ' (on)' : ''}`}
                    onPointerDown={(e) => onCellDown(e, x, y, lit)}
                    onPointerEnter={() => onCellEnter(x, y)}
                  />
                ))
              )}
            </div>

            <div className="glyf__tools">
              <div className="glyf__nudge">
                <button
                  type="button"
                  className="glyf__btn glyf__btn--icon glyf__btn--up"
                  onClick={() => setFont((f) => shiftGlyph(f, selected, 0, -1))}
                  title="Nudge up"
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="glyf__btn glyf__btn--icon glyf__btn--left"
                  onClick={() => setFont((f) => shiftGlyph(f, selected, -1, 0))}
                  title="Nudge left"
                >
                  ←
                </button>
                <button
                  type="button"
                  className="glyf__btn glyf__btn--icon glyf__btn--right"
                  onClick={() => setFont((f) => shiftGlyph(f, selected, 1, 0))}
                  title="Nudge right"
                >
                  →
                </button>
                <button
                  type="button"
                  className="glyf__btn glyf__btn--icon glyf__btn--down"
                  onClick={() => setFont((f) => shiftGlyph(f, selected, 0, 1))}
                  title="Nudge down"
                >
                  ↓
                </button>
              </div>

              <label className="glyf__field">
                <span>WIDTH</span>
                <input
                  type="number"
                  min={1}
                  max={font.width}
                  value={glyph.width}
                  disabled={font.monospaced}
                  onChange={(e) => setFont((f) => setGlyphWidth(f, selected, Number(e.target.value)))}
                  aria-label="This glyph's advance width"
                />
              </label>

              <label className="glyf__field glyf__field--grow">
                <span>COPY FROM</span>
                <select
                  value=""
                  onChange={(e) => {
                    const from = Number(e.target.value)
                    if (Number.isInteger(from)) setFont((f) => copyGlyph(f, from, selected))
                  }}
                  aria-label="Copy another glyph into this one"
                >
                  <option value="">…</option>
                  {font.glyphs
                    .filter((g) => g.code !== selected && glyphHasInk(g))
                    .map((g) => (
                      <option key={g.code} value={g.code}>
                        {codeLabel(g.code)}
                      </option>
                    ))}
                </select>
              </label>

              <div className="glyf__row">
                <button
                  type="button"
                  className="glyf__btn"
                  disabled={font.monospaced}
                  onClick={() => setFont((f) => autoWidth(f, selected, 1))}
                  title="Shrink this glyph to its ink + 1px of spacing"
                >
                  Fit
                </button>
                <button
                  type="button"
                  className="glyf__btn"
                  onClick={() => setFont((f) => invertGlyph(f, selected))}
                  title="Swap ink and paper"
                >
                  Invert
                </button>
                <button
                  type="button"
                  className="glyf__btn"
                  onClick={() => setFont((f) => clearGlyph(f, selected))}
                  title="Erase this glyph"
                >
                  Clear
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── 1× preview ─────────────────────────────────────────────────── */}
        <div className="glyf__preview">
          <div className="glyf__screen" title={`${previewGrid.w}px wide at 1×`}>
            <svg
              viewBox={`0 0 ${Math.max(1, previewGrid.w)} ${Math.max(1, previewGrid.h)}`}
              width={Math.max(1, previewGrid.w)}
              height={Math.max(1, previewGrid.h)}
              role="img"
              aria-label={`Preview of “${preview}” at actual size`}
              shapeRendering="crispEdges"
            >
              {previewGrid.pixels.flatMap((row, y) =>
                row.map((lit, x) =>
                  lit ? (
                    <rect key={`${x},${y}`} x={x} y={y} width="1" height="1" className="glyf__lit" />
                  ) : null
                )
              )}
            </svg>
          </div>
          <input
            type="text"
            className="glyf__sample"
            value={preview}
            spellCheck={false}
            onChange={(e) => setPreview(e.target.value)}
            aria-label="Preview text"
          />
          <span className="glyf__measure">{measureText(font, preview)}px</span>
        </div>

        {/* ── Export ─────────────────────────────────────────────────────── */}
        <div className="glyf__export">
          <label className="glyf__field glyf__field--grow">
            <span>EXPORT</span>
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value as FontExportFormat)}
              aria-label="Export format"
            >
              {FONT_EXPORT_FORMATS.map((f) => (
                <option key={f.id} value={f.id} title={f.blurb}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="glyf__btn glyf__btn--primary"
            onClick={onExport}
            title={`Write ${exportFilename(font)} into the editor`}
          >
            {exportFilename(font)}
          </button>
        </div>

        <div className="glyf__foot">
          <span className="glyf__status">
            {note ?? FONT_EXPORT_FORMATS.find((f) => f.id === format)?.blurb}
          </span>
          <button type="button" className="glyf__link" onClick={onReset}>
            Starter font
          </button>
        </div>
      </div>
    </InstrumentWindow>
  )
}
