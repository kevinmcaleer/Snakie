import { useWorkspaceLayout, WORKSPACE_IDS, WORKSPACE_INFO } from '../store/layout'
import './WorkspaceSwitcher.css'

/**
 * WORKSPACE SWITCHER (epic #259, Phase 1) — one-click named layouts.
 *
 * A compact segmented control in the toolbar: **Code · Board · Lab · Data**.
 * Each workspace remembers its own geometry (sidebar view, panel sizes,
 * collapse states, instrument dock); switching restyles the SAME mounted tree
 * so nothing (editor, console scrollback, instruments) is lost. The ↺ button
 * restores the active workspace to its factory preset — the always-available
 * "Reset layout" escape hatch.
 *
 * Reads the layout store directly (no prop threading through Toolbar).
 */
export function WorkspaceSwitcher(): JSX.Element {
  const layout = useWorkspaceLayout()

  return (
    <div className="ws-switcher" role="group" aria-label="Workspace layout">
      <div className="ws-switcher__seg">
        {WORKSPACE_IDS.map((id) => (
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
      <button
        type="button"
        className="ws-switcher__reset"
        title={`Reset the ${WORKSPACE_INFO[layout.active].label} layout to its default`}
        aria-label={`Reset the ${WORKSPACE_INFO[layout.active].label} workspace layout`}
        onClick={() => layout.resetActive()}
      >
        <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false">
          <path
            d="M13 8a5 5 0 1 1-1.5-3.6M13 2.5V5h-2.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  )
}
