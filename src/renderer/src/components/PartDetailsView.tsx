import { type CSSProperties, useMemo, type JSX } from 'react'
import { Markdown } from './Markdown'
import { PartPreview } from './PartPreview'
import {
  partCodeModule,
  partDetailSections,
  partDocLinks,
  partDriverRows,
  partHelpBody,
  partSpecRows,
  partTagList,
  resolveSuggestedModules,
  type PartDetailSection
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
          title={
            selected ? 'Remove this part from the selection' : 'Add this part to the selection'
          }
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
          {/* The stage itself is shared with the Board Finder (#934), so a board
              is turned over and read the same way wherever you meet it. */}
          <PartPreview part={part} libraryId={libraryId} pinout />
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
function Section({
  id,
  part
}: {
  id: PartDetailSection
  part: PartDefinition
}): JSX.Element | null {
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
