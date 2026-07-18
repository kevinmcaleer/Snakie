import { useMemo, useState } from 'react'
import type { Column } from './data-table'
import {
  profileColumn,
  gapPercent,
  type ColumnProfile,
  type NumericProfile,
  type TextProfile
} from './data-view-profile'
import './DataColumnPanel.css'

/**
 * DATA COLUMN PANEL (#276, epic #272) — the DuckDB Column Explorer: a side panel
 * that profiles every column of the CURRENT (filtered/sorted) view.
 * =============================================================================
 *
 * One card per column, type-aware: numbers/timestamps get a histogram +
 * min/max/mean/median; text gets its top values by frequency. Every card shows
 * the null/gap % (dropped-reading quality signal). Compact by default — a
 * sparkline you can click to expand to the full chart. Recomputes whenever the
 * view changes; only mounted (hence only computed) when the panel is open.
 */
export function DataColumnPanel({
  columns,
  rows,
  view
}: {
  columns: readonly Column[]
  rows: readonly string[][]
  /** Filtered/sorted row indices (the visible set). */
  view: readonly number[]
}): JSX.Element {
  const profiles = useMemo(
    () => columns.map((c) => profileColumn(rows, c.index, c.type, view)),
    [columns, rows, view]
  )
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const toggle = (idx: number): void =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })

  return (
    <aside className="dcp" aria-label="Column summary">
      <div className="dcp__head">Columns</div>
      <div className="dcp__list">
        {columns.map((c, i) => (
          <ColumnCard
            key={c.index}
            column={c}
            profile={profiles[i]}
            expanded={expanded.has(c.index)}
            onToggle={() => toggle(c.index)}
          />
        ))}
      </div>
    </aside>
  )
}

function ColumnCard({
  column,
  profile,
  expanded,
  onToggle
}: {
  column: Column
  profile: ColumnProfile
  expanded: boolean
  onToggle: () => void
}): JSX.Element {
  const gap = gapPercent(profile)
  return (
    <div className={`dcp__card${expanded ? ' is-expanded' : ''}`}>
      <button type="button" className="dcp__card-head" onClick={onToggle} aria-expanded={expanded}>
        <span className="dcp__card-caret" aria-hidden="true">
          {expanded ? '▾' : '▸'}
        </span>
        <span className="dcp__card-name" title={column.name}>
          {column.name}
        </span>
        <span className={`dcp__card-type dcp__card-type--${column.type}`}>{column.type}</span>
        {gap > 0 && (
          <span className="dcp__card-gap" title={`${profile.nulls} empty / dropped`}>
            {gap < 1 ? '<1' : Math.round(gap)}% ∅
          </span>
        )}
      </button>
      {profile.kind === 'string'
        ? renderText(profile, expanded)
        : renderNumeric(profile, expanded)}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Numeric / timestamp: a histogram + stats.
// ---------------------------------------------------------------------------
function renderNumeric(p: NumericProfile, expanded: boolean): JSX.Element {
  if (p.count === 0) return <p className="dcp__empty">all empty</p>
  const fmt = (n: number): string =>
    p.kind === 'timestamp' ? tsShort(n) : Math.abs(n) >= 1000 ? n.toFixed(0) : n.toFixed(2)
  const peak = Math.max(1, ...p.bins)
  return (
    <div className="dcp__body">
      <div className={`dcp__hist${expanded ? ' dcp__hist--tall' : ''}`} role="img" aria-label="distribution">
        {p.bins.map((b, i) => (
          <div
            key={i}
            className="dcp__bar"
            style={{ height: `${(b / peak) * 100}%` }}
            title={`${fmt(p.binEdges[i])}–${fmt(p.binEdges[i + 1])}: ${b}`}
          />
        ))}
      </div>
      {expanded ? (
        <dl className="dcp__stats">
          <div><dt>min</dt><dd>{fmt(p.min)}</dd></div>
          <div><dt>max</dt><dd>{fmt(p.max)}</dd></div>
          {p.kind === 'number' && (
            <>
              <div><dt>mean</dt><dd>{fmt(p.mean)}</dd></div>
              <div><dt>median</dt><dd>{fmt(p.median)}</dd></div>
            </>
          )}
          <div><dt>count</dt><dd>{p.count.toLocaleString()}</dd></div>
          {p.nulls > 0 && (
            <div><dt>empty</dt><dd>{p.nulls.toLocaleString()}</dd></div>
          )}
        </dl>
      ) : (
        <div className="dcp__range">
          <span>{fmt(p.min)}</span>
          {p.kind === 'number' && <span className="dcp__range-mid">μ {fmt(p.mean)}</span>}
          <span>{fmt(p.max)}</span>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Text: top values by frequency.
// ---------------------------------------------------------------------------
function renderText(p: TextProfile, expanded: boolean): JSX.Element {
  if (p.count === 0) return <p className="dcp__empty">all empty</p>
  const peak = Math.max(1, ...p.top.map((t) => t.count))
  const shown = expanded ? p.top : p.top.slice(0, 3)
  return (
    <div className="dcp__body">
      <div className="dcp__uniq">{p.distinct.toLocaleString()} distinct</div>
      <ul className="dcp__freq">
        {shown.map((t) => (
          <li key={t.value} className="dcp__freq-row" title={`${t.value}: ${t.count}`}>
            <span className="dcp__freq-label">{t.value}</span>
            <span className="dcp__freq-bar" style={{ width: `${(t.count / peak) * 100}%` }} />
            <span className="dcp__freq-count">{t.count.toLocaleString()}</span>
          </li>
        ))}
      </ul>
      {!expanded && p.top.length > 3 && (
        <div className="dcp__more">+{p.distinct - 3} more</div>
      )}
    </div>
  )
}

/** Short timestamp label (epoch-ms date or ms-of-day clock). */
function tsShort(ms: number): string {
  if (ms < 86400000) {
    const s = Math.floor(ms / 1000)
    return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`
  }
  return new Date(ms).toISOString().slice(0, 10)
}
