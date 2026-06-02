/**
 * ACTIVITY BAR — narrow vertical icon strip on the far left.
 *
 * Switches the left sidebar between views. The active view id is owned by
 * AppShell (persisted via useLocalStorage under `snakie.activityView`) and
 * passed down here; clicking an item calls `onSelect`.
 *
 * Items are split into a top group (primary views) and a bottom group (Help),
 * mirroring the familiar VS Code-style activity bar.
 */

/** Stable, persisted view ids. Default is `files`. */
export type ActivityView = 'files' | 'source-control' | 'packages' | 'inspect' | 'help'

interface ActivityItem {
  id: ActivityView
  label: string
  icon: string
}

const TOP_ITEMS: ActivityItem[] = [
  { id: 'files', label: 'Files', icon: '🗀' },
  { id: 'source-control', label: 'Source', icon: '⎇' },
  { id: 'packages', label: 'Packages', icon: '📦' },
  { id: 'inspect', label: 'Inspect', icon: '🔍' }
]

const BOTTOM_ITEMS: ActivityItem[] = [{ id: 'help', label: 'Help', icon: '?' }]

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
      <span className="activitybar__item-icon" aria-hidden="true">
        {item.icon}
      </span>
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
