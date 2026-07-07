import type { JSX, ReactNode } from 'react'
import { isElectron } from '../lib/platform'

/**
 * ACTIVITY BAR — narrow vertical icon strip on the far left.
 *
 * Switches the left sidebar between views. The active view id is owned by
 * AppShell (persisted via useLocalStorage under `snakie.activityView`) and
 * passed down here; clicking an item calls `onSelect`.
 *
 * Items are split into a top group (primary views) and a bottom group (Report
 * Bug + Help + Settings), mirroring the familiar VS Code-style activity bar.
 * Icons are inline pixel SVGs (drawn with crisp edges) so they render identically
 * on every platform and match the 8-bit theme — the pixel UI font has no emoji
 * glyphs. Settings is an ACTION (opens the Settings dialog via `onOpenSettings`),
 * not a persisted view, so it sits below Help without an active/pressed state.
 */

/** Stable, persisted view ids. Default is `files`. */
export type ActivityView =
  | 'files'
  | 'source-control'
  | 'packages'
  | 'plugins'
  | 'inspect'
  | 'report-bug'
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
  // magnifier
  inspect: SVG(
    <g fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="6.5" cy="6.5" r="4" />
      <path d="M9.8 9.8 14 14" />
    </g>
  ),
  // bug (beetle): rounded body, head, antennae + legs
  'report-bug': SVG(
    <g stroke="currentColor" strokeWidth="1.3" fill="none">
      <ellipse cx="8" cy="9" rx="3.2" ry="4" fill="currentColor" stroke="none" />
      <circle cx="8" cy="4" r="1.4" fill="currentColor" stroke="none" />
      <path d="M6.8 3 6 1.6M9.2 3 10 1.6" strokeLinecap="round" />
      <path
        d="M4.8 7.5 2.5 6.5M4.6 9.5H2.3M4.8 11.5 2.5 12.5M11.2 7.5l2.3-1M11.4 9.5h2.3M11.2 11.5l2.3 1"
        strokeLinecap="round"
      />
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

// Gear — the Settings action (a view-less button below Help). Pixel-styled to
// match the other shelf icons: 8 teeth around a ringed body.
const SETTINGS_ICON = SVG(
  <g fill="currentColor">
    <rect x="7" y="0" width="2" height="4" />
    <rect x="7" y="12" width="2" height="4" />
    <rect x="0" y="7" width="4" height="2" />
    <rect x="12" y="7" width="4" height="2" />
    <rect x="2" y="2" width="2.5" height="2.5" />
    <rect x="11.5" y="2" width="2.5" height="2.5" />
    <rect x="2" y="11.5" width="2.5" height="2.5" />
    <rect x="11.5" y="11.5" width="2.5" height="2.5" />
    <path
      fillRule="evenodd"
      d="M8 3.4a4.6 4.6 0 1 0 0 9.2 4.6 4.6 0 0 0 0-9.2Zm0 2.7a1.9 1.9 0 1 1 0 3.8 1.9 1.9 0 0 1 0-3.8Z"
    />
  </g>
)

interface ActivityItem {
  id: ActivityView
  label: string
}

const TOP_ITEMS: ActivityItem[] = [
  { id: 'files', label: 'Files' },
  { id: 'source-control', label: 'Source' },
  { id: 'packages', label: 'Packages' },
  { id: 'plugins', label: 'Plugins' },
  { id: 'inspect', label: 'Inspect' }
]

/**
 * Views that need a real filesystem + spawned processes (`simple-git`, the
 * Python plugin host) that a browser tab can't provide — hidden outside
 * Electron (Web W3, issue #284). Exported so `AppShell`'s `LeftView` can guard
 * the panel body too (in case a persisted `activityView` from a previous
 * Electron session points at one of these in a browser).
 */
export const DESKTOP_ONLY_VIEWS: ReadonlySet<ActivityView> = new Set(['source-control', 'plugins'])

// Report Bug sits ABOVE Help (issue #206). It's a normal VIEW now — a non-modal
// left panel — so the editor + console stay usable while a report is open.
const BOTTOM_ITEMS: ActivityItem[] = [
  { id: 'report-bug', label: 'Report Bug' },
  { id: 'help', label: 'Help' }
]

interface ActivityBarProps {
  active: ActivityView
  onSelect: (view: ActivityView) => void
  /** Open the Settings dialog (the Settings item is an action, not a view). */
  onOpenSettings: () => void
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

export function ActivityBar({ active, onSelect, onOpenSettings }: ActivityBarProps): JSX.Element {
  // Hide desktop-only views (Source Control, Plugins) outside Electron — a
  // browser tab has no filesystem/process access for git or the plugin host
  // (Web W3, issue #284).
  const topItems = isElectron() ? TOP_ITEMS : TOP_ITEMS.filter((item) => !DESKTOP_ONLY_VIEWS.has(item.id))
  return (
    <nav className="activitybar" aria-label="Activity bar">
      <div className="activitybar__group">
        {topItems.map((item) => renderItem(item, active, onSelect))}
      </div>
      <div className="activitybar__group activitybar__group--bottom">
        {BOTTOM_ITEMS.map((item) => renderItem(item, active, onSelect))}
        {/* Settings — an action, not a view (opens the Settings dialog), so no
            aria-pressed / is-active. Same markup as the other shelf items. */}
        <button
          type="button"
          className="activitybar__item"
          title="Settings"
          onClick={onOpenSettings}
        >
          <span className="activitybar__item-icon">{SETTINGS_ICON}</span>
          <span className="activitybar__item-label">Settings</span>
        </button>
      </div>
    </nav>
  )
}
