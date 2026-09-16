import { Fragment } from 'react'
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
 * THE DOT (#1053). Between Blocks and Code sits a small dot: the in-between of
 * those two, where both are on screen at once. Clicking it lights BOTH segments,
 * because that is what you get. It is not a fifth workspace — Electronics and
 * Build are workspaces; this is a stop on the way between two of them, and the
 * visible half of the divider #1034 made the control.
 *
 * Soft Shell (#575, epic #573) surfaces three: **Code · Electronics · Build**
 * (Electronics = the Board View; Build = the former Robot). Data Lab was retired
 * in the epic's close-out (#581), so all of WORKSPACE_IDS is shown. Reads the
 * layout store directly. (The reset-layout icon was removed (#…) — resetting is
 * still available via `layout.resetActive()` if a control is wired up later.)
 */
const VISIBLE_WORKSPACES = WORKSPACE_IDS

const BOTH_HINT = 'Blocks and Python side by side — the same program, twice'

export function WorkspaceSwitcher(): JSX.Element {
  const layout = useWorkspaceLayout()
  const both = layout.blocksBoth

  return (
    <div className="ws-switcher" role="group" aria-label="Workspace layout">
      <div className={`ws-switcher__seg${both ? ' is-both' : ''}`}>
        {VISIBLE_WORKSPACES.map((id) => (
          <Fragment key={id}>
            <button
              type="button"
              data-ws={id}
              className={`ws-switcher__btn${
                // While the dot is lit, BOTH of its neighbours read as active —
                // the highlight spans them, because what is on screen is both.
                layout.active === id || (both && (id === 'blocks' || id === 'code'))
                  ? ' is-active'
                  : ''
              }`}
              aria-pressed={layout.active === id || (both && (id === 'blocks' || id === 'code'))}
              title={WORKSPACE_INFO[id].hint}
              onClick={() => layout.switchWorkspace(id)}
            >
              {WORKSPACE_INFO[id].label}
            </button>
            {/* THE DOT (#1053), between Blocks and Code and nowhere else.
                Blocks and code together is not a fourth workspace — it is the
                in-between of those two — so it is a stop on the way rather
                than another segment. #1034 made the divider the control and it
                turned out to be invisible: this is the visible half. */}
            {id === 'blocks' && (
              <button
                type="button"
                className={`ws-switcher__dot${both ? ' is-active' : ''}`}
                aria-pressed={both}
                title={BOTH_HINT}
                aria-label={BOTH_HINT}
                onClick={() => layout.setBlocksBoth(!both)}
              >
                <span className="ws-switcher__dot-mark" aria-hidden="true" />
              </button>
            )}
          </Fragment>
        ))}
      </div>
    </div>
  )
}
