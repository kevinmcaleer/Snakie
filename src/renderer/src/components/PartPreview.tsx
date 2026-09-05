import { Suspense, lazy, useEffect, useMemo, useState, type JSX } from 'react'
import { PartCanvas } from './PartCanvas'
import { PartSchematicView } from './PartSchematicView'
import { partHasRear, type PartDefinition } from '../../../shared/part'
import { resolvedPins } from './part-editor.util'
import { useCoinFlip } from '../hooks/useCoinFlip'
import { partMeshRef, partPreviewModes, pinoutReading, type PartPreviewMode } from './part-details'
import './PartPreview.css'

/**
 * THE PART STAGE (#934) — one board, turned over, modelled and read.
 * =============================================================================
 *
 * The tabs, the coin flip and the mat, lifted out of {@link PartDetailsView} so
 * the Board Finder can show a board's actual hardware without a second copy of
 * them. It is deliberately ONE component rather than two similar ones: the board
 * view already exists twice in this app (in-window and popped-out) and a feature
 * added to one silently missed the other for weeks, which is a mistake worth not
 * repeating on a smaller surface.
 *
 * THE HOSTS DISAGREE ABOUT COLOUR, and that is the only thing they disagree
 * about. The Parts Catalog is a light page; the Board Finder is dark in both
 * skins, on purpose, like the flasher. So the chrome — tabs, flip button — takes
 * its four colours from `--ppv-*` custom properties, defaulting to the catalog's,
 * and a dark host restates them. The MAT does not participate: `--bc-mat` is dark
 * everywhere already, because pin labels and schematic strokes are drawn light
 * across the whole app and a white stage would render a pinout invisible.
 *
 * THE PINOUT READOUT is opt-in. The canvas draws every pin's capability chips
 * whether or not anyone hovers, which is right for a board you are studying and
 * useless for the question people actually arrive with — "which pad is GP4?". So
 * `pinout` puts hit targets on the pads, rings the one under the pointer, and
 * says it in words underneath. Keyboard users get the same readout from a select,
 * because a hover-only fact is a fact some readers cannot have.
 */

/** Lazily loaded: three.js and the STL/DAE parsers stay out of the main chunk and
 *  arrive only when someone opens a part that actually has a model. */
const PartMeshView = lazy(() => import('./PartMeshView').then((m) => ({ default: m.PartMeshView })))

const PREVIEW_LABELS: Record<PartPreviewMode, string> = {
  board: 'Board',
  schematic: 'Schematic',
  model: '3-D'
}

export interface PartPreviewProps {
  part: PartDefinition
  /** The library the part came from — half of what resolves its 3-D model. */
  libraryId: string
  /** Offer the pad-by-pad readout under the stage. */
  pinout?: boolean
  /** Host class, for restating the `--ppv-*` chrome colours. */
  className?: string
}

/** The two-headed arrow of a "turn the board over" control. */
function flipIcon(): JSX.Element {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <ellipse cx="8" cy="8" rx="3" ry="6.4" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M2.4 5.6A6.4 6.4 0 0 1 13.6 5.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
      <path
        d="M13.6 10.4A6.4 6.4 0 0 1 2.4 10.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
      <path
        d="M1.2 2.2l1 2.4 2.4-1"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M14.8 13.8l-1-2.4-2.4 1"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function PartPreview({
  part,
  libraryId,
  pinout = false,
  className
}: PartPreviewProps): JSX.Element {
  // The parts folder is only knowable from the main process, and only the desktop
  // has one — the web build reports `''`, which resolves every mesh to nothing.
  const [partsFolder, setPartsFolder] = useState('')
  useEffect(() => {
    let live = true
    void window.api?.parts
      ?.partsFolder?.()
      .then((f) => {
        if (live) setPartsFolder(f ?? '')
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [])

  const mesh = useMemo(
    () => partMeshRef(part, { partsFolder, libraryId }),
    [part, partsFolder, libraryId]
  )
  const modes = useMemo(() => partPreviewModes(!!mesh), [mesh])
  const [mode, setMode] = useState<PartPreviewMode>('board')
  // A different part starts face-up on the board tab…
  useEffect(() => setMode('board'), [part.id])
  // …and a mode that is no longer on offer can never be left showing an empty
  // stage (the 3-D tab exists only while its mesh resolves).
  useEffect(() => {
    if (!modes.includes(mode)) setMode('board')
  }, [modes, mode])

  const { face, flipping, flipTo } = useCoinFlip()
  const twoSided = partHasRear(part)

  // The pins in canvas order, so an index from the canvas indexes this list.
  const pins = useMemo(() => (pinout ? resolvedPins(part) : []), [part, pinout])
  const [hover, setHover] = useState<number | null>(null)
  // A pad on the back is not on screen while the front is showing, so a stale
  // hover from before the flip would name a pin nobody can point at.
  useEffect(() => setHover(null), [face, mode, part.id])

  const reading = hover != null && pins[hover] ? pinoutReading(pins[hover].pin, part.mcu) : null

  return (
    <div className={`ppv${className ? ` ${className}` : ''}`}>
      <div className="ppv__tabs">
        <span className="ppv__tablist" role="tablist" aria-label="Preview">
          {modes.map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              className={`ppv__tab${mode === m ? ' is-active' : ''}`}
              onClick={() => setMode(m)}
            >
              {PREVIEW_LABELS[m]}
            </button>
          ))}
        </span>
        <span className="ppv__tabs-spacer" />
        {/* Only offered when there IS a back — a single-sided part shouldn't
            invite you to turn it over and find nothing (#636). */}
        {mode === 'board' && twoSided && (
          <button
            type="button"
            className="ppv__flip-btn"
            onClick={() => flipTo(face === 'front' ? 'rear' : 'front')}
            disabled={flipping}
            title={face === 'front' ? 'Show the back of the board' : 'Show the front of the board'}
          >
            {flipIcon()}
            <span>{face === 'front' ? 'Flip to back' : 'Flip to front'}</span>
          </button>
        )}
      </div>

      {/* The mat is the STAGE and stays put; only the board turns on it. */}
      <div className="ppv__stage">
        {mode === 'board' && (
          <div className={`ppv__flip${flipping ? ' is-flipping' : ''}`}>
            <PartCanvas
              part={part}
              readOnly
              side={face}
              onHoverPin={pinout ? setHover : undefined}
              hoverPin={hover}
            />
          </div>
        )}
        {mode === 'schematic' && <PartSchematicView part={part} />}
        {mode === 'model' && mesh && (
          <Suspense fallback={<div className="ppv__stage-note">Loading the 3-D model…</div>}>
            {/* The stored orientation correction (#741) — shown the way the Part
                Editor squared it up. */}
            <PartMeshView
              path={mesh.path}
              label={part.name}
              rotation={part.meshRotation}
              offset={part.meshOffset}
            />
          </Suspense>
        )}
      </div>

      {pinout && mode === 'board' && pins.length > 0 && (
        <div className="ppv__pinout">
          {/* The readout keeps its height whether or not a pad is hovered — a
              strip that appears on hover would shift the board out from under
              the pointer that summoned it. */}
          <p className="ppv__pin-read" aria-live="polite">
            {reading ? (
              <>
                <span className="ppv__pin-name">{reading.name}</span>
                {reading.number && <span className="ppv__pin-num">{reading.number}</span>}
                <span className={`ppv__pin-role is-${pins[hover!].pin.type}`}>{reading.role}</span>
                {reading.functions.map((f) => (
                  <span className="ppv__pin-fn" key={f}>
                    {f}
                  </span>
                ))}
              </>
            ) : (
              <span className="ppv__pin-hint">
                Hover a pad to read it, or pick one from the list.
              </span>
            )}
          </p>
          {/* The same facts without a pointer. A hover-only readout is one a
              keyboard or screen-reader user simply never gets. */}
          <label className="ppv__pin-pick">
            <span className="ppv__pin-pick-label">Pin</span>
            <select
              value={hover ?? ''}
              onChange={(e) => setHover(e.target.value === '' ? null : Number(e.target.value))}
            >
              <option value="">Choose a pin…</option>
              {pins.map((rp, i) => (
                <option value={i} key={`${rp.hi}.${rp.pi}`}>
                  {rp.pin.number != null ? `${rp.pin.number} · ` : ''}
                  {rp.pin.label || rp.pin.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
    </div>
  )
}
