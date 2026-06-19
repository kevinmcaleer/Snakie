import { ChatPanel } from './ChatPanel'

/**
 * RIGHT PANE — Chat only (collapsible, collapsed by default).
 *
 * The right pane is now dedicated to the chat assistant. The other tools that
 * previously lived here as tabs (Outline, Variables, Packages, Source Control,
 * Help) have moved to the left sidebar's activity-bar views (see ActivityBar +
 * AppShell). The Toolbar's right-pane toggle is labelled "Chat" and shows/hides
 * this pane.
 *
 * The redundant "Chat" title bar was dropped in issue #83 (the toolbar toggle
 * already names the pane) along with the chat's inline settings — those moved to
 * the Settings dialog's Chat tab.
 */
export function RightPanel(): JSX.Element {
  return (
    <section className="region region--right" aria-label="Chat">
      <div className="region__body">
        <ChatPanel />
      </div>
    </section>
  )
}
