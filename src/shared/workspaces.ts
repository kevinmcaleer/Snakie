/**
 * THE NAMED WORKSPACES — shared between the renderer and the main process.
 *
 * These three facts (the ids, their display labels, and how to validate an id
 * that arrived from somewhere else) used to live inside the renderer's layout
 * store. The application menu needs them too — View ▸ Workspace is built from
 * `WORKSPACE_IDS` and labelled from `WORKSPACE_INFO` (#916), so a fourth
 * workspace appears on the menu without anyone editing the menu — and the main
 * process cannot import a React store. So they live here, and
 * `src/renderer/src/store/layout.ts` re-exports them: one list, two processes,
 * no chance of the menu and the switcher disagreeing about what exists.
 */

/** The named workspaces. Order = the switcher's display order (Code · Electronics
 *  · Build). Soft Shell (#581, epic #573) retired the never-surfaced Data Lab —
 *  its instrument bench lives on in the Code/Build docks. Stale `lab`/`data`/
 *  `datalab` persisted state coerces to `code` in `loadLayoutState`. */
export const WORKSPACE_IDS = ['code', 'board', 'robot'] as const
export type WorkspaceId = (typeof WORKSPACE_IDS)[number]

/** Display labels + a one-line description for the switcher tooltips. */
// Soft Shell (#575, epic #573) renamed the switcher's three workspaces to
// Code / Electronics / Build. "Electronics" surfaces the Board View; "Build"
// (was "Robot") won't collide with the upcoming electronics simulator.
export const WORKSPACE_INFO: Record<WorkspaceId, { label: string; hint: string }> = {
  code: { label: 'Code', hint: 'Editor-first: files, editor and console' },
  board: {
    label: 'Electronics',
    hint: 'Wire components to your board — the Board View beside your code'
  },
  robot: { label: 'Build', hint: 'Assemble the robot in 3D — joints, IK chains and poses' }
}

/**
 * A workspace id from OUTSIDE this window, or null (#775).
 *
 * Since any window — a detached instrument, the board window — can ask the main
 * window to show a workspace, the id arrives as an unvalidated string across a
 * process boundary. A retired id (`lab`/`data`) or a typo would otherwise apply
 * geometry that doesn't exist and strand the user on a workspace with no
 * switcher segment. Null means "don't switch", which is the only safe answer to
 * a name this build doesn't have.
 */
export function coerceWorkspaceId(id: unknown): WorkspaceId | null {
  return typeof id === 'string' && (WORKSPACE_IDS as readonly string[]).includes(id)
    ? (id as WorkspaceId)
    : null
}
