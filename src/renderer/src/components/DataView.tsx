import { useEffect, useMemo, useRef, useState } from 'react'
import { useWorkspace } from '../store/workspace'
import { parseTable, delimiterLabel, type Column, type ColumnType } from './data-table'
import {
  computeView,
  nextSort,
  summariseColumn,
  isActiveFilter,
  type Filter,
  type SortState,
  type ColumnSummary
} from './data-view-ops'
import './DataView.css'

/**
 * DATA VIEW (#274, epic #272) — a spreadsheet-like viewer for a logged CSV/TXT
 * file, the retrospective counterpart to the live instruments.
 * =============================================================================
 *
 * Reads the active local file, parses it with the robust {@link ./data-table}
 * ingest (delimiter/header/type detection, ragged-row tolerant), and renders it
 * VIRTUALISED — only the rows in view are in the DOM — so an 86k-row 24-hour log
 * (1 reading/sec) scrolls without choking. This is the foundation; sort/filter
 * (#275), the column summary panel (#276), pull-from-board (#277), graph (#278)
 * and export (#279) build on the same parsed model.
 */

const ROW_H = 26 // px per data row (fixed → cheap virtualisation math)
const COL_W = 150 // px per column (fixed → horizontal scroll when wide)
const OVERSCAN = 8 // extra rows above/below the viewport

const alignFor = (t: ColumnType): 'right' | 'left' => (t === 'number' ? 'right' : 'left')

export function DataView(): JSX.Element {
  const { openFiles, activeId } = useWorkspace()
  const activeFile = openFiles.find((f) => f.id === activeId) ?? null
  const content = activeFile?.content ?? ''

  // A user override for the header toggle (null = use auto-detection).
  const [headerOverride, setHeaderOverride] = useState<boolean | null>(null)

  // Parsing is the expensive step — memoise on the content + the toggle.
  const table = useMemo(
    () => parseTable(content, headerOverride === null ? {} : { hasHeader: headerOverride }),
    [content, headerOverride]
  )

  // Sort + per-column filters (#275). Reset both when switching file.
  const [sort, setSort] = useState<SortState | null>(null)
  const [filters, setFilters] = useState<Map<number, Filter>>(new Map())
  const [showFilters, setShowFilters] = useState(false)
  useEffect(() => {
    setHeaderOverride(null)
    setSort(null)
    setFilters(new Map())
    setShowFilters(false)
  }, [activeId])

  const { columns, rows, raggedRows } = table

  // The visible view = filtered + sorted row indices (recomputed on any change).
  const view = useMemo(
    () => computeView(rows, columns, filters, sort),
    [rows, columns, filters, sort]
  )
  // Per-column summaries over the VISIBLE set (recompute on sort/filter).
  const summaries = useMemo(
    () => columns.map((c) => summariseColumn(rows, c.index, c.type, view)),
    [rows, columns, view]
  )
  const activeFilters = useMemo(
    () => [...filters.values()].filter(isActiveFilter).length,
    [filters]
  )

  const setFilter = (col: number, f: Filter | null): void => {
    setFilters((prev) => {
      const next = new Map(prev)
      if (f === null || !isActiveFilter(f)) next.delete(col)
      else next.set(col, f)
      return next
    })
  }

  // --- Virtualisation: track the scroll viewport + its height ----------------
  const scrollRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewH, setViewH] = useState(600)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const measure = (): void => setViewH(el.clientHeight)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const total = view.length
  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN)
  const visibleCount = Math.ceil(viewH / ROW_H) + OVERSCAN * 2
  const last = Math.min(total, first + visibleCount)
  const template = `repeat(${columns.length}, ${COL_W}px)`
  const innerW = columns.length * COL_W

  if (columns.length === 0) {
    return (
      <div className="dv dv--empty">
        <p className="dv__empty-text">
          {content.trim() ? 'No table data found in this file.' : 'This file is empty.'}
        </p>
      </div>
    )
  }

  const visible: JSX.Element[] = []
  for (let k = first; k < last; k++) {
    const rowIdx = view[k]
    const row = rows[rowIdx]
    visible.push(
      <div
        key={rowIdx}
        className="dv__row"
        style={{ transform: `translateY(${k * ROW_H}px)`, gridTemplateColumns: template }}
      >
        <div className="dv__gutter">{rowIdx + 1}</div>
        {columns.map((c) => (
          <div key={c.index} className="dv__cell" style={{ textAlign: alignFor(c.type) }}>
            {row[c.index] === '' ? <span className="dv__null">·</span> : row[c.index]}
          </div>
        ))}
      </div>
    )
  }

  const filtered = activeFilters > 0

  return (
    <div className="dv">
      <div className="dv__toolbar">
        <span className="dv__stat">
          {filtered ? (
            <>
              <strong>{total.toLocaleString()}</strong> of {rows.length.toLocaleString()} rows
            </>
          ) : (
            <>
              <strong>{rows.length.toLocaleString()}</strong> rows
            </>
          )}{' '}
          · <strong>{columns.length}</strong> cols
        </span>
        <span className="dv__stat dv__stat--muted">{delimiterLabel(table.delimiter)}-delimited</span>
        {raggedRows > 0 && (
          <span className="dv__stat dv__stat--warn" title="Rows padded or truncated to fit the columns">
            ⚠ {raggedRows.toLocaleString()} ragged
          </span>
        )}
        <div className="dv__toolbar-actions">
          <button
            type="button"
            className={`dv__btn${showFilters ? ' is-on' : ''}`}
            onClick={() => setShowFilters((s) => !s)}
            title="Show per-column filters"
          >
            Filter{activeFilters > 0 ? ` (${activeFilters})` : ''}
          </button>
          {filtered && (
            <button type="button" className="dv__btn" onClick={() => setFilters(new Map())}>
              Clear
            </button>
          )}
          <label className="dv__toggle">
            <input
              type="checkbox"
              checked={table.hasHeader}
              onChange={(e) => setHeaderOverride(e.target.checked)}
            />
            Header row
          </label>
        </div>
      </div>

      <div className="dv__grid" ref={scrollRef} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
        <div className="dv__inner" style={{ width: innerW + 48 }}>
          <div className="dv__top">
            <div className="dv__head" style={{ gridTemplateColumns: template }}>
              <div className="dv__gutter dv__gutter--head" />
              {columns.map((c) => {
                const sorted = sort?.col === c.index ? sort.dir : null
                return (
                  <button
                    key={c.index}
                    type="button"
                    className={`dv__th${sorted ? ' is-sorted' : ''}`}
                    title={`${c.name} · ${c.type} — click to sort`}
                    onClick={() => setSort((s) => nextSort(s, c.index))}
                  >
                    <span className="dv__th-name">
                      {c.name}
                      {sorted && <span className="dv__sort">{sorted === 'asc' ? '▲' : '▼'}</span>}
                    </span>
                    <span className={`dv__th-type dv__th-type--${c.type}`}>{c.type}</span>
                  </button>
                )
              })}
            </div>

            <div className="dv__summary" style={{ gridTemplateColumns: template }}>
              <div className="dv__gutter dv__gutter--head" />
              {columns.map((c, i) => (
                <div key={c.index} className="dv__sum">
                  {renderSummary(summaries[i])}
                </div>
              ))}
            </div>

            {showFilters && (
              <div className="dv__filters" style={{ gridTemplateColumns: template }}>
                <div className="dv__gutter dv__gutter--head" />
                {columns.map((c) => (
                  <FilterCell
                    key={c.index}
                    column={c}
                    value={filters.get(c.index) ?? null}
                    onChange={(f) => setFilter(c.index, f)}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="dv__body" style={{ height: total * ROW_H }}>
            {visible}
          </div>
        </div>
      </div>
    </div>
  )
}

/** Compact per-column stats for the summary strip. */
function renderSummary(s: ColumnSummary): JSX.Element {
  const gap = s.nulls > 0 && (
    <span className="dv__sum-gap" title={`${s.nulls} empty / dropped`}>
      {s.nulls}∅
    </span>
  )
  if ((s.type === 'number' || s.type === 'timestamp') && s.count > 0) {
    const fmt = (n: number): string =>
      s.type === 'timestamp' ? tsShort(n) : Math.abs(n) >= 100 ? n.toFixed(0) : n.toFixed(2)
    return (
      <>
        <span className="dv__sum-main" title="min – max">
          {fmt(s.min!)} – {fmt(s.max!)}
        </span>
        {s.type === 'number' && s.mean !== undefined && (
          <span className="dv__sum-sub" title="mean">
            μ {Math.abs(s.mean) >= 100 ? s.mean.toFixed(0) : s.mean.toFixed(2)}
          </span>
        )}
        {gap}
      </>
    )
  }
  if (s.type === 'string') {
    return (
      <>
        <span className="dv__sum-main" title="distinct values">
          {s.distinct} uniq
        </span>
        {s.top !== undefined && (
          <span className="dv__sum-sub" title={`most common (${s.topCount})`}>
            {s.top}
          </span>
        )}
        {gap}
      </>
    )
  }
  return <span className="dv__sum-sub">—</span>
}

/** A best-effort short timestamp label for the summary (epoch-ms or ms-of-day). */
function tsShort(ms: number): string {
  if (ms < 86400000) {
    // ms-of-day (bare clock) → HH:MM
    const s = Math.floor(ms / 1000)
    return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`
  }
  return new Date(ms).toISOString().slice(0, 10)
}

/** One column's filter input: min/max for number-ish, text for strings. */
function FilterCell({
  column,
  value,
  onChange
}: {
  column: Column
  value: Filter | null
  onChange: (f: Filter | null) => void
}): JSX.Element {
  if (column.type === 'string') {
    const v = value?.kind === 'text' ? value : null
    return (
      <div className="dv__filter">
        <button
          type="button"
          className="dv__filter-mode"
          title={v?.mode === 'equals' ? 'Equals — click for contains' : 'Contains — click for equals'}
          onClick={() =>
            onChange({
              kind: 'text',
              mode: v?.mode === 'equals' ? 'contains' : 'equals',
              value: v?.value ?? ''
            })
          }
        >
          {v?.mode === 'equals' ? '=' : '⊃'}
        </button>
        <input
          className="dv__filter-input"
          type="text"
          placeholder="filter"
          value={v?.value ?? ''}
          onChange={(e) =>
            onChange({ kind: 'text', mode: v?.mode ?? 'contains', value: e.target.value })
          }
        />
      </div>
    )
  }
  const r = value?.kind === 'range' ? value : null
  // Blank OR non-finite → null (a NaN bound would mark the filter "active" yet
  // never actually constrain — review #275). type=number already blocks most.
  const num = (s: string): number | null => {
    if (s.trim() === '') return null
    const n = Number(s)
    return Number.isFinite(n) ? n : null
  }
  return (
    <div className="dv__filter">
      <input
        className="dv__filter-input dv__filter-input--range"
        type="number"
        placeholder="min"
        value={r?.min ?? ''}
        onChange={(e) => onChange({ kind: 'range', min: num(e.target.value), max: r?.max ?? null })}
      />
      <input
        className="dv__filter-input dv__filter-input--range"
        type="number"
        placeholder="max"
        value={r?.max ?? ''}
        onChange={(e) => onChange({ kind: 'range', min: r?.min ?? null, max: num(e.target.value) })}
      />
    </div>
  )
}
