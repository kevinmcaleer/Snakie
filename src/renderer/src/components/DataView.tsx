import { useEffect, useMemo, useRef, useState } from 'react'
import { useWorkspace } from '../store/workspace'
import { parseTable, delimiterLabel, type ColumnType } from './data-table'
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

  // Reset the header override when switching to a different file.
  useEffect(() => {
    setHeaderOverride(null)
  }, [activeId])

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

  const { columns, rows, raggedRows } = table
  const total = rows.length
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
  for (let i = first; i < last; i++) {
    const row = rows[i]
    visible.push(
      <div
        key={i}
        className="dv__row"
        style={{ transform: `translateY(${i * ROW_H}px)`, gridTemplateColumns: template }}
      >
        <div className="dv__gutter">{i + 1}</div>
        {columns.map((c) => (
          <div key={c.index} className="dv__cell" style={{ textAlign: alignFor(c.type) }}>
            {row[c.index] === '' ? <span className="dv__null">·</span> : row[c.index]}
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="dv">
      <div className="dv__toolbar">
        <span className="dv__stat">
          <strong>{total.toLocaleString()}</strong> rows · <strong>{columns.length}</strong> cols
        </span>
        <span className="dv__stat dv__stat--muted">{delimiterLabel(table.delimiter)}-delimited</span>
        {raggedRows > 0 && (
          <span className="dv__stat dv__stat--warn" title="Rows padded or truncated to fit the columns">
            ⚠ {raggedRows.toLocaleString()} ragged
          </span>
        )}
        <label className="dv__toggle">
          <input
            type="checkbox"
            checked={table.hasHeader}
            onChange={(e) => setHeaderOverride(e.target.checked)}
          />
          First row is a header
        </label>
      </div>

      <div className="dv__grid" ref={scrollRef} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
        <div className="dv__inner" style={{ width: innerW + 48 }}>
          <div className="dv__head" style={{ gridTemplateColumns: template }}>
            <div className="dv__gutter dv__gutter--head" />
            {columns.map((c) => (
              <div key={c.index} className="dv__th" title={`${c.name} · ${c.type}`}>
                <span className="dv__th-name">{c.name}</span>
                <span className={`dv__th-type dv__th-type--${c.type}`}>{c.type}</span>
              </div>
            ))}
          </div>
          <div className="dv__body" style={{ height: total * ROW_H }}>
            {visible}
          </div>
        </div>
      </div>
    </div>
  )
}
