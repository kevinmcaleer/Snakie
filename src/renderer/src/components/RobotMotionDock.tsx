import { useCallback, useState, type JSX, type ReactNode } from 'react'
import './RobotMotionDock.css'

/**
 * MOTION DOCK (#403 follow-up) — one collapsible bottom dock that tabs between the
 * three Motion Studio surfaces (Keyframes / Sequence / Controls) instead of
 * stacking three full-width bars. Only the active tab's panel mounts; a chevron
 * collapses the dock to just its tab strip (giving the full 3-D stage back). The
 * active tab + collapsed state persist across sessions, and a tab shows a dot when
 * that surface already has content, so a populated-but-hidden surface advertises
 * itself. Own `robotdock__` BEM prefix (instrument CSS is global).
 */

export interface MotionTab {
  id: string
  label: string
  /** Show a dot on the tab (this surface has authored content). */
  badge?: boolean
  content: ReactNode
}

export interface RobotMotionDockProps {
  tabs: MotionTab[]
}

const STORE_KEY = 'snakie:motionDock'

interface DockState {
  active: string
  collapsed: boolean
}

function loadState(fallback: string): DockState {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (raw) {
      const s = JSON.parse(raw) as Partial<DockState>
      return { active: typeof s.active === 'string' ? s.active : fallback, collapsed: s.collapsed === true }
    }
  } catch {
    /* corrupt / unavailable storage — fall through to the default */
  }
  return { active: fallback, collapsed: false }
}

export function RobotMotionDock({ tabs }: RobotMotionDockProps): JSX.Element {
  const first = tabs[0]?.id ?? ''
  const [state, setState] = useState<DockState>(() => loadState(first))
  // Guard against a persisted id that no longer exists (e.g. a renamed tab).
  const active = tabs.some((t) => t.id === state.active) ? state.active : first
  const { collapsed } = state

  const persist = useCallback((next: DockState) => {
    setState(next)
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(next))
    } catch {
      /* best-effort — a preference not persisting is non-fatal */
    }
  }, [])

  // Clicking a tab always expands to it (so a hidden dock opens on the surface you
  // asked for); the chevron just toggles visibility of the current tab.
  const selectTab = (id: string): void => persist({ active: id, collapsed: false })
  const toggleCollapsed = (): void => persist({ active, collapsed: !collapsed })

  const activeTab = tabs.find((t) => t.id === active) ?? tabs[0]

  return (
    <div className={`robotdock${collapsed ? ' is-collapsed' : ''}`}>
      <div className="robotdock__tabs" role="tablist" aria-label="Motion tools">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={!collapsed && t.id === active}
            className={`robotdock__tab${!collapsed && t.id === active ? ' is-active' : ''}`}
            onClick={() => selectTab(t.id)}
          >
            {t.label}
            {t.badge && <span className="robotdock__badge" title="has content" aria-hidden="true" />}
          </button>
        ))}
        <span className="robotdock__spacer" />
        <button
          type="button"
          className="robotdock__collapse"
          onClick={toggleCollapsed}
          title={collapsed ? 'Show motion tools' : 'Hide motion tools (reclaim the 3-D view)'}
          aria-label={collapsed ? 'Expand motion dock' : 'Collapse motion dock'}
        >
          {collapsed ? '⌃' : '⌄'}
        </button>
      </div>
      {!collapsed && <div className="robotdock__body">{activeTab?.content}</div>}
    </div>
  )
}

export default RobotMotionDock
