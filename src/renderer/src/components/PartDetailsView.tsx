import { type CSSProperties, Suspense, lazy, useEffect, useMemo, useState, type JSX } from 'react'
import { PartCanvas } from './PartCanvas'
import { PartSchematicView } from './PartSchematicView'
import { Markdown } from './Markdown'
import { partHasRear } from '../../../shared/part'
import { useCoinFlip } from '../hooks/useCoinFlip'
import {
  partCodeModule,
  partDetailSections,
  partDocLinks,
  partDriverRows,
  partHelpBody,
  partMeshRef,
  partPreviewModes,
  partSpecRows,
  partTagList,
  resolveSuggestedModules,
  type PartDetailSection,
  type PartPreviewMode
} from './part-details'
import type { PartDefinition } from '../../../shared/part'
import './PartDetailsView.css'

/**
 * THE FULL-SIZED PART DETAILS VIEW (#748).
 * =============================================================================
 *
 * Opened from a card's hover disclosure in the full-screen catalog, closed from
 * the ✕ top right. It is a DETOUR, not a navigation: it renders over the grid,
 * which stays mounted behind it, so closing restores the selection, the filters
 * and even the scroll position without any of them being saved or restored.
 *
 * A reading surface. The one action it carries is the catalog's own — tick this
 * part into the selection — so a decision made here doesn't cost a hunt back
 * through the grid for the card. Authoring (edit / duplicate / promote / reset to
 * bundled) stays in the docked Parts panel, where the part you are working on is.
 *
 * Everything it SHOWS is decided by `part-details.ts` — which sections exist, in
 * what order, and whether the 3-D tab can be offered at all — so those rules are
 * unit-tested rather than asserted by eye. Unique `pdt__` BEM prefix.
 */

/** Lazily loaded: three.js + the STL/DAE parsers stay out of the main chunk and
 *  arrive only when someone opens a part that actually has a model. */
const PartMeshView = lazy(() => import('./PartMeshView').then((m) => ({ default: m.PartMeshView })))

export interface PartDetailsViewProps {
  libraryId: string
  part: PartDefinition
  /** Whether the part is ticked in the catalog's selection. */
  selected: boolean
  /** Tick / untick it — the catalog's own toggle, so the count stays honest. */
  onToggleSelected: () => void
  /** Back to the grid. */
  onClose: () => void
  /**
   * Where the view should appear to grow FROM: the centre of the disclosure
   * that opened it, in pixels relative to the catalog panel. Absent (a keyboard
   * open, or a caller that doesn't track it) simply means no animation, rather
   * than one that flies in from an arbitrary corner.
   */
  origin?: { x: number; y: number } | null
  /** Play the closing animation. The caller keeps this mounted until it hears
   *  {@link onClosed} — unmounting on the click would leave nothing to animate. */
  closing?: boolean
  /** The shrink has finished; safe to unmount. */
  onClosed?: () => void
}

const PREVIEW_LABELS: Record<PartPreviewMode, string> = {
  board: 'Board',
  schematic: 'Schematic',
  model: '3-D'
}

/** The two-headed arrow of a "turn the board over" control. */
function flipIcon(): JSX.Element {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <ellipse cx="8" cy="8" rx="3" ry="6.4" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M2.2 4.4A6.6 6.6 0 0 1 8 1.4" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M13.8 11.6A6.6 6.6 0 0 1 8 14.6" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M1.2 2.2l1 2.4 2.4-1" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14.8 13.8l-1-2.4-2.4 1" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function PartDetailsView({
  libraryId,
  part,
  selected,
  onToggleSelected,
  onClose,
  origin,
  closing,
  onClosed
}: PartDetailsViewProps): JSX.Element {
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

  const mesh = useMemo(() => partMeshRef(part, { partsFolder, libraryId }), [part, partsFolder, libraryId])
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
  const sections = useMemo(() => partDetailSections(part), [part])
  const subtitle = [part.family, part.manufacturer, part.partNumber].filter(Boolean).join(' · ')

  return (
    <section
      className={`pdt${closing ? ' is-closing' : origin ? ' is-growing' : ''}`}
      // Only the ROOT's own animation counts: children animate too (the coin
      // flip, the tabs), and their events bubble up here.
      onAnimationEnd={(e) => {
        if (closing && e.target === e.currentTarget) onClosed?.()
      }}
      // The origin rides in as custom properties so the keyframes stay in CSS —
      // only the ONE number that can't be known until the click is passed in.
      style={
        origin
          ? ({ '--pdt-ox': `${origin.x}px`, '--pdt-oy': `${origin.y}px` } as CSSProperties)
          : undefined
      }
      aria-label={`${part.name} details`}
    >
      <header className="pdt__head">
        <div className="pdt__titles">
          <h2 className="pdt__title">{part.name}</h2>
          {subtitle && <p className="pdt__sub">{subtitle}</p>}
        </div>
        <button
          type="button"
          className={`pdt__select${selected ? ' is-on' : ''}`}
          onClick={onToggleSelected}
          aria-pressed={selected}
          title={selected ? 'Remove this part from the selection' : 'Add this part to the selection'}
        >
          {selected ? '✓ Selected' : '+ Select'}
        </button>
        <button
          type="button"
          className="pdt__close"
          onClick={onClose}
          aria-label="Close part details"
          title="Back to the catalog (Esc)"
        >
          ✕
        </button>
      </header>

      <div className="pdt__body">
        <div className="pdt__stage-col">
          <div className="pdt__tabs">
            <span className="pdt__tablist" role="tablist" aria-label="Preview">
              {modes.map((m) => (
                <button
                  key={m}
                  type="button"
                  role="tab"
                  aria-selected={mode === m}
                  className={`pdt__tab${mode === m ? ' is-active' : ''}`}
                  onClick={() => setMode(m)}
                >
                  {PREVIEW_LABELS[m]}
                </button>
              ))}
            </span>
            <span className="pdt__tabs-spacer" />
            {/* Only offered when there IS a back — a single-sided part shouldn't
                invite you to turn it over and find nothing (#636). */}
            {mode === 'board' && twoSided && (
              <button
                type="button"
                className="pdt__flip-btn"
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
          <div className="pdt__stage">
            {mode === 'board' && (
              <div className={`pdt__flip${flipping ? ' is-flipping' : ''}`}>
                <PartCanvas part={part} readOnly side={face} />
              </div>
            )}
            {mode === 'schematic' && <PartSchematicView part={part} />}
            {mode === 'model' && mesh && (
              <Suspense fallback={<div className="pdt__stage-note">Loading the 3-D model…</div>}>
                <PartMeshView path={mesh.path} label={part.name} />
              </Suspense>
            )}
          </div>
        </div>

        <div className="pdt__info-col">
          {part.description && <p className="pdt__lede">{part.description}</p>}
          {sections.map((id) => (
            <Section key={id} id={id} part={part} />
          ))}
        </div>
      </div>
    </section>
  )
}

/** One panel of the info column. Which panels exist — and their order — is decided
 *  (and tested) by `partDetailSections`; this only says how each one looks. */
function Section({ id, part }: { id: PartDetailSection; part: PartDefinition }): JSX.Element | null {
  switch (id) {
    case 'specs':
      return (
        <div className="pdt__panel">
          <h3 className="pdt__panel-head">Specifications</h3>
          <dl className="pdt__specs">
            {partSpecRows(part).map((row) => (
              <div className="pdt__spec" key={row.label}>
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )
    case 'tags':
      return (
        <div className="pdt__panel">
          <h3 className="pdt__panel-head">Tags</h3>
          <div className="pdt__tags">
            {partTagList(part).map((t) => (
              <span className="pdt__tag" key={t}>
                {t}
              </span>
            ))}
          </div>
        </div>
      )
    case 'drivers': {
      const rows = partDriverRows(part)
      const mod = partCodeModule(part)
      return (
        <div className="pdt__panel">
          <h3 className="pdt__panel-head">Driver</h3>
          {mod && (
            <p className="pdt__import">
              Imported as <code className="pdt__code">{mod}</code>
            </p>
          )}
          {rows.length > 0 && (
            <ul className="pdt__drivers">
              {rows.map((d) => (
                <li className="pdt__driver" key={d.key}>
                  <span className="pdt__driver-name">{d.label}</span>
                  <span className={`pdt__driver-how pdt__driver-how--${d.method}`}>{d.method}</span>
                  <span className="pdt__driver-sum">{d.summary}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )
    }
    case 'works-with':
      return (
        <div className="pdt__panel">
          <h3 className="pdt__panel-head">Works with</h3>
          {/* Listed, not installed: the catalog is where a part is CHOSEN. Pushing
              a driver onto the board from here would install for a part that isn't
              in the project yet — the docked panel's "Works with" does that, on a
              part you already have. */}
          <ul className="pdt__works">
            {resolveSuggestedModules(part).map(({ module, unlocks }) => (
              <li className="pdt__work" key={module.id}>
                <span className="pdt__work-name">{module.name}</span>
                <span className="pdt__work-unlocks">{unlocks}</span>
              </li>
            ))}
          </ul>
        </div>
      )
    case 'links':
      return (
        <div className="pdt__panel">
          <h3 className="pdt__panel-head">Links</h3>
          <ul className="pdt__links">
            {partDocLinks(part).map((l) => (
              <li key={l.href}>
                <a
                  className="pdt__link"
                  href={l.href}
                  onClick={(e) => {
                    // Open in the user's real browser, never in the renderer.
                    e.preventDefault()
                    void window.api?.openExternal?.(l.href).catch(() => undefined)
                  }}
                >
                  {l.label} ↗
                </a>
              </li>
            ))}
          </ul>
        </div>
      )
    case 'help':
      return (
        <div className="pdt__panel pdt__panel--help">
          <h3 className="pdt__panel-head">Guide</h3>
          <Markdown source={partHelpBody(part)} className="pdt__md" />
        </div>
      )
    default:
      return null
  }
}
