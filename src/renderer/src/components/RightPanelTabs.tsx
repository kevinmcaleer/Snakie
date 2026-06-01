import { ReactNode, useState } from 'react'
import './RightPanelTabs.css'

/**
 * A single tab in the right-pane tabbed host (issue #22).
 *
 * @property id      Stable, unique key (e.g. 'help', 'chat', 'packages').
 * @property title   Short label shown in the tab strip.
 * @property icon    Optional leading glyph (emoji or single char) shown before
 *                   the title. Purely decorative — keep titles self-describing.
 * @property content The panel body, rendered when this tab is active.
 */
export interface RightPanelTab {
  id: string
  title: string
  icon?: ReactNode
  content: ReactNode
}

/**
 * RIGHT PANE TABBED HOST (issue #22)
 * ==================================
 *
 * A self-contained, renderer-only tab system for the right pane. It is the
 * mounting point for progressively-disclosed tools so the default layout stays
 * uncluttered.
 *
 * HOW TO ADD A TAB
 * ----------------
 * Tabs are plain data — there is no global registry to wire up. To add one,
 * append a `RightPanelTab` object to the `tabs` array passed to this component
 * from `RightPanel.tsx`:
 *
 *   const tabs: RightPanelTab[] = [
 *     { id: 'help', title: 'Help', icon: '?', content: <HelpPanel /> },
 *     // LLM chat (#18):
 *     { id: 'chat', title: 'Chat', icon: '💬', content: <ChatPanel /> },
 *     // Package installer (#20):
 *     { id: 'packages', title: 'Packages', icon: '📦', content: <PackagePanel /> },
 *     // Variables inspector (#16):
 *     { id: 'vars', title: 'Variables', icon: '{}', content: <VariablesPanel /> },
 *   ]
 *
 * Build your tool as its own component under `components/` (with a co-located
 * CSS file) and drop it in `content`. Order in the array = order in the strip;
 * `id` must be unique and stable. The first tab is selected by default unless
 * `defaultTabId` is supplied.
 */
interface RightPanelTabsProps {
  tabs: RightPanelTab[]
  /** Optional id of the tab to select on first render (defaults to first). */
  defaultTabId?: string
}

export function RightPanelTabs({ tabs, defaultTabId }: RightPanelTabsProps): JSX.Element {
  const initial = tabs.some((t) => t.id === defaultTabId) ? defaultTabId! : tabs[0]?.id
  const [activeId, setActiveId] = useState<string | undefined>(initial)

  if (tabs.length === 0) return <></>

  const active = tabs.find((t) => t.id === activeId) ?? tabs[0]

  return (
    <div className="rptabs">
      <div className="rptabs__strip" role="tablist" aria-label="Side panel tools">
        {tabs.map((tab) => {
          const selected = tab.id === active.id
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`rptab-${tab.id}`}
              aria-selected={selected}
              aria-controls={`rppanel-${tab.id}`}
              className={`rptabs__tab${selected ? ' rptabs__tab--active' : ''}`}
              onClick={() => setActiveId(tab.id)}
            >
              {tab.icon != null && (
                <span className="rptabs__tab-icon" aria-hidden="true">
                  {tab.icon}
                </span>
              )}
              <span className="rptabs__tab-label">{tab.title}</span>
            </button>
          )
        })}
      </div>
      <div
        className="rptabs__panel"
        role="tabpanel"
        id={`rppanel-${active.id}`}
        aria-labelledby={`rptab-${active.id}`}
      >
        {active.content}
      </div>
    </div>
  )
}
