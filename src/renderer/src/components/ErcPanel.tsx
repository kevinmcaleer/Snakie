/**
 * ELECTRICAL RULES CHECK — board-view badge + issues panel (epic #597, #601 UI).
 * =============================================================================
 * The incremental-discovery surface for the ERC engine (`src/shared/erc.ts`):
 * a compact BADGE in the Board View header (worst-severity colour + counts, or a
 * quiet ✓ when the circuit is clean) that expands into a panel of issue cards.
 * Each card is one plain-English finding with a "why it matters" explainer — an
 * ERC that only names the fault teaches nothing.
 *
 * Rendered inside `BoardGraph`, so BOTH board views (in-window + pop-out) get it
 * from the one component (the two-board-views parity trap). Pure presentation —
 * it just renders the `ErcIssue[]` the engine returns. Unique `erc__` BEM prefix
 * (instrument/board CSS is global); reads in both dark + light skins.
 */
import type { JSX } from 'react'
import type { ErcIssue, ErcSeverity, ErcSummary } from '../../../shared/erc'
import './ErcPanel.css'

/** Severity → glyph. Kept text-glyphs (not emoji) so they render on Linux too. */
const SEV_GLYPH: Record<ErcSeverity, string> = { error: '✕', warning: '!', info: 'i' }
const SEV_LABEL: Record<ErcSeverity, string> = { error: 'Error', warning: 'Warning', info: 'Info' }

/** The header badge: click to toggle the panel. Shows counts, or a ✓ when clean. */
export function ErcBadge({
  summary,
  open,
  onToggle
}: {
  summary: ErcSummary
  open: boolean
  onToggle: () => void
}): JSX.Element {
  const clean = summary.total === 0
  const cls = `erc__badge${open ? ' is-open' : ''} erc__badge--${clean ? 'clean' : (summary.worst ?? 'clean')}`
  return (
    <button
      type="button"
      className={cls}
      onClick={onToggle}
      aria-pressed={open}
      aria-label={clean ? 'Electrical rules check: no issues' : `Electrical rules check: ${summary.total} issue${summary.total === 1 ? '' : 's'}`}
      title={clean ? 'Electrical Rules Check — no issues found' : 'Electrical Rules Check — click to see the issues'}
    >
      <span className="erc__badge-dot" aria-hidden="true" />
      ERC
      {clean ? (
        <span className="erc__badge-count erc__badge-count--ok" aria-hidden="true">✓</span>
      ) : (
        <span className="erc__badge-counts">
          {summary.errors > 0 && <span className="erc__badge-count erc__badge-count--error">{SEV_GLYPH.error}{summary.errors}</span>}
          {summary.warnings > 0 && <span className="erc__badge-count erc__badge-count--warning">{SEV_GLYPH.warning}{summary.warnings}</span>}
          {summary.infos > 0 && <span className="erc__badge-count erc__badge-count--info">{SEV_GLYPH.info}{summary.infos}</span>}
        </span>
      )}
    </button>
  )
}

/** One issue card: severity chip + title + message + "why it matters". */
function IssueCard({ issue }: { issue: ErcIssue }): JSX.Element {
  return (
    <li className={`erc__row erc__row--${issue.severity}`}>
      <span className={`erc__sev erc__sev--${issue.severity}`} title={SEV_LABEL[issue.severity]} aria-label={SEV_LABEL[issue.severity]}>
        {SEV_GLYPH[issue.severity]}
      </span>
      <div className="erc__row-body">
        <div className="erc__row-title">{issue.title}</div>
        <div className="erc__row-msg">{issue.message}</div>
        <div className="erc__row-why">
          <span className="erc__why-label">Why it matters:</span> {issue.why}
        </div>
      </div>
    </li>
  )
}

/** The expandable issues panel. */
export function ErcPanel({ issues, onClose }: { issues: ErcIssue[]; onClose: () => void }): JSX.Element {
  return (
    <div className="erc__panel" role="dialog" aria-label="Electrical Rules Check">
      <div className="erc__panel-head">
        <span className="erc__panel-title">Electrical Rules Check</span>
        <button type="button" className="erc__panel-close" onClick={onClose} aria-label="Close" title="Close">
          ✕
        </button>
      </div>
      {issues.length === 0 ? (
        <div className="erc__empty">
          <span className="erc__empty-tick" aria-hidden="true">✓</span>
          No electrical issues found in the wiring.
        </div>
      ) : (
        <ul className="erc__list">
          {issues.map((issue, i) => (
            <IssueCard key={`${issue.rule}-${i}`} issue={issue} />
          ))}
        </ul>
      )}
    </div>
  )
}
