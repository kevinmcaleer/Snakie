import { useWorkspaceLayout, WORKSPACE_IDS, WORKSPACE_INFO } from '../store/layout'
import './WorkspaceSwitcher.css'

/**
 * WORKSPACE SWITCHER (epic #259, Phase 1) — one-click named layouts.
 *
 * A prominent segmented control centred in the toolbar — the app's primary mode
 * switch. Each workspace remembers its own geometry (sidebar view, panel sizes,
 * collapse states, instrument dock); switching restyles the SAME mounted tree so
 * nothing (editor, console scrollback, instruments) is lost.
 *
 * Soft Shell (#575, epic #573) surfaces three: **Code · Electronics · Build**
 * (Electronics = the Board View; Build = the former Robot). Data Lab was retired
 * in the epic's close-out (#581), so all of WORKSPACE_IDS is shown. Reads the
 * layout store directly. (The reset-layout icon was removed (#…) — resetting is
 * still available via `layout.resetActive()` if a control is wired up later.)
 */
const VISIBLE_WORKSPACES = WORKSPACE_IDS

export function WorkspaceSwitcher(): JSX.Element {
  const layout = useWorkspaceLayout()

  return (
    <div className="ws-switcher" role="group" aria-label="Workspace layout">
      <div className="ws-switcher__seg">
        {VISIBLE_WORKSPACES.map((id) => (
          <button
            key={id}
            type="button"
            className={`ws-switcher__btn${layout.active === id ? ' is-active' : ''}`}
            aria-pressed={layout.active === id}
            title={WORKSPACE_INFO[id].hint}
            onClick={() => layout.switchWorkspace(id)}
          >
            {WORKSPACE_INFO[id].label}
          </button>
        ))}
      </div>
    </div>
  )
}
