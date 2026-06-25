import type { JSX, ReactNode } from 'react'

/**
 * ACTIVITY BAR — narrow vertical icon strip on the far left.
 *
 * Switches the left sidebar between views. The active view id is owned by
 * AppShell (persisted via useLocalStorage under `snakie.activityView`) and
 * passed down here; clicking an item calls `onSelect`.
 *
 * Items are split into a top group (primary views) and a bottom group (Help),
 * mirroring the familiar VS Code-style activity bar. Icons are inline pixel
 * SVGs (drawn with crisp edges) so they render identically on every platform
 * and match the 8-bit theme — the pixel UI font has no emoji glyphs.
 */

/** Stable, persisted view ids. Default is `files`. */
export type ActivityView =
  | 'files'
  | 'source-control'
  | 'packages'
  | 'plugins'
  | 'parts'
  | 'inspect'
  | 'help'

const SVG = (children: ReactNode): JSX.Element => (
  <svg
    viewBox="0 0 16 16"
    width="20"
    height="20"
    shapeRendering="crispEdges"
    aria-hidden="true"
    focusable="false"
  >
    {children}
  </svg>
)

const ICONS: Record<ActivityView, JSX.Element> = {
  // folder
  files: SVG(<path d="M1 3h5l2 2h7v8H1z" fill="currentColor" />),
  // git branch: three nodes joined
  'source-control': SVG(
    <g fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M4 5v6M4 8h5a2 2 0 0 0 2-2V5" />
      <rect x="2.5" y="2.5" width="3" height="3" fill="currentColor" stroke="none" />
      <rect x="2.5" y="10.5" width="3" height="3" fill="currentColor" stroke="none" />
      <rect x="9.5" y="2.5" width="3" height="3" fill="currentColor" stroke="none" />
    </g>
  ),
  // package cube
  packages: SVG(
    <g fill="none" stroke="currentColor" strokeWidth="1.4">
      <path d="M8 1.5 14.5 5v6L8 14.5 1.5 11V5z" />
      <path d="M1.5 5 8 8.5 14.5 5M8 8.5V14.5" />
    </g>
  ),
  // puzzle piece
  plugins: SVG(
    <path
      fill="currentColor"
      d="M6 1h4v2a1 1 0 0 0 2 0V2h3v3h-1a1 1 0 0 0 0 2h1v4h-2a1 1 0 0 1-1-1 1 1 0 0 0-2 0 1 1 0 0 1-1 1H6v-3a1 1 0 0 0-2 0v3H1V8h1a1 1 0 0 0 0-2H1V3h3a1 1 0 0 0 2 0z"
    />
  ),
  // IC chip with legs (a hardware "part")
  parts: SVG(
    <g fill="none" stroke="currentColor" strokeWidth="1.4">
      <rect x="4.5" y="4.5" width="7" height="7" fill="currentColor" stroke="none" />
      <path d="M2 6h2.5M2 9h2.5M11.5 6H14M11.5 9H14M6 2v2.5M9 2v2.5M6 11.5V14M9 11.5V14" />
    </g>
  ),
  // magnifier
  inspect: SVG(
    <g fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="6.5" cy="6.5" r="4" />
      <path d="M9.8 9.8 14 14" />
    </g>
  ),
  // question mark in a box
  help: SVG(
    <g fill="currentColor">
      <path d="M5 5a3 3 0 1 1 4 2.8c-.7.4-1 .7-1 1.4V10H7V9c0-1.2.6-1.8 1.4-2.3A1.3 1.3 0 1 0 6.6 5z" />
      <rect x="7" y="11.5" width="2" height="2" />
    </g>
  )
}

interface ActivityItem {
  id: ActivityView
  label: string
}

const TOP_ITEMS: ActivityItem[] = [
  { id: 'files', label: 'Files' },
  { id: 'source-control', label: 'Source' },
  { id: 'packages', label: 'Packages' },
  { id: 'plugins', label: 'Plugins' },
  { id: 'parts', label: 'Parts' },
  { id: 'inspect', label: 'Inspect' }
]

const BOTTOM_ITEMS: ActivityItem[] = [{ id: 'help', label: 'Help' }]

interface ActivityBarProps {
  active: ActivityView
  onSelect: (view: ActivityView) => void
}

function renderItem(
  item: ActivityItem,
  active: ActivityView,
  onSelect: (view: ActivityView) => void
): JSX.Element {
  const selected = item.id === active
  return (
    <button
      key={item.id}
      type="button"
      className={`activitybar__item${selected ? ' is-active' : ''}`}
      aria-pressed={selected}
      title={item.label}
      onClick={() => onSelect(item.id)}
    >
      <span className="activitybar__item-icon">{ICONS[item.id]}</span>
      <span className="activitybar__item-label">{item.label}</span>
    </button>
  )
}

export function ActivityBar({ active, onSelect }: ActivityBarProps): JSX.Element {
  return (
    <nav className="activitybar" aria-label="Activity bar">
      <div className="activitybar__group">
        {TOP_ITEMS.map((item) => renderItem(item, active, onSelect))}
      </div>
      <div className="activitybar__group activitybar__group--bottom">
        {BOTTOM_ITEMS.map((item) => renderItem(item, active, onSelect))}
      </div>
    </nav>
  )
}
