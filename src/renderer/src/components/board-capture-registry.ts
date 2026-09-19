/**
 * HOW THE EXPORT MOUNTS A BOARD IT CANNOT SEE (#1110, #1147).
 *
 * The export never photographs the canvas on screen — it renders a board of its
 * own, dressed for the page (see `lib/pdf/wiring-capture.ts`). This is how it
 * asks for one: the same publish-and-undo shape as
 * `lib/blocks/workspace-registry.ts`.
 *
 * WHY A REGISTRY RATHER THAN A SECOND REACT ROOT. `wiring-capture` used to
 * render its own `createRoot(host)` and put a `<BoardPane>` in it. A root of its
 * own is a TREE of its own, with none of `App.tsx`'s providers above it, so the
 * pane threw `useWorkspace must be used within a WorkspaceProvider` on its first
 * render — off in a root nothing was watching, where it showed up only as a
 * capture that never settled and a document with no Electronics page in it.
 *
 * So the app itself does the mounting: {@link BoardCaptureHost} sits inside the
 * providers and portals a `<BoardPane>` into whatever off-screen host the
 * exporter hands over, on the mat it asks for (#1168 — the page wants the white
 * print mat, whatever the window is set to). The pane then reads the SAME workspace the Electronics
 * view would — the open folder, the active file, the settings — so the picture
 * in the document is the picture the learner would see, rather than a second
 * board assembled out of defaults.
 */

/** The mat a captured board is drawn on — the export asks for the white one. */
export type CaptureMat = 'dark' | 'blueprint' | 'white'

/** Mount a board into `host`; the returned function takes it down again. */
export type BoardCaptureMount = (host: HTMLElement, mat: CaptureMat) => () => void

let current: BoardCaptureMount | null = null

/** Publish the app's off-screen mounter. Returns the undo. */
export function registerBoardCaptureMount(mount: BoardCaptureMount): () => void {
  current = mount
  return () => {
    // Only clear if we are still the current one: a remount can register the
    // new host before the old one's cleanup runs.
    if (current === mount) current = null
  }
}

/**
 * Render a board into `host`, or null when there is no app tree to render it
 * in (a bare renderer — an instrument's detached window, a preview). Null is an
 * answer, not a failure: the caller leaves the wiring page out rather than
 * printing a blank one.
 */
export function mountCaptureBoard(host: HTMLElement, mat: CaptureMat): (() => void) | null {
  return current ? current(host, mat) : null
}

/** Test seam. */
export function resetBoardCaptureRegistry(): void {
  current = null
}
