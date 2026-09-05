/**
 * Per-file detail on a library install (#895).
 * =============================================================================
 *
 * Installing the Arduino Modulino package copies 22 files over the raw REPL,
 * plus three dependency packages it pulls in transitively. That takes a while —
 * and with nothing moving on screen there is no way to tell a slow install from
 * a dead one. The reported symptom was "installing the modulino library appears
 * to hang".
 *
 * The information already existed. `writeFilesToBoard` has always reported every
 * file as it went:
 *
 *     onStep(`Writing ${++done}/${files.length} — ${file.path}…`)
 *
 * but only as prose, inside the progress event's free-text `message`. Anything
 * wanting the file, the index or the total had to parse that sentence back
 * apart, which is not a thing to build on. So the same facts travel
 * structurally as well, and the sentence stays exactly as it was for the panels
 * that display it.
 *
 * Mixed into BOTH install progress payloads — modules and packages — because
 * they share one writer underneath, and the fix belongs there rather than in
 * each caller.
 */

/** What a file is doing, mirroring the device queue's own step states. */
export type InstallFileState = 'running' | 'done' | 'error'

/**
 * The structured half of an install progress event. Every field is optional:
 * an install emits notes, errors and lifecycle states that have nothing to do
 * with any particular file.
 */
export interface InstallFileProgress {
  /**
   * Every file this install will write, device paths, in the order they will be
   * written. Emitted ONCE, before the first write — a progress list that grows
   * as it goes cannot show how much is left, which is the question being asked.
   */
  files?: readonly string[]
  /** Index into {@link files} of the file this event concerns. */
  fileIndex?: number
  /** What just happened to it. */
  fileState?: InstallFileState
}

/**
 * Fold one progress event into a list of file states.
 *
 * Pure, so the reporting can be tested without a board: hand it the events an
 * install emits and check the list ends up how the dialog should draw it.
 */
export function applyFileProgress(
  prev: { files: readonly string[]; states: readonly InstallFileState[] },
  event: InstallFileProgress
): { files: readonly string[]; states: readonly InstallFileState[] } {
  // The file list arriving resets the run: a second install through the same
  // reporter must not inherit the first one's ticks.
  if (event.files) {
    return { files: event.files, states: event.files.map(() => 'running' as const) }
  }
  if (event.fileIndex === undefined || event.fileState === undefined) return prev
  if (event.fileIndex < 0 || event.fileIndex >= prev.states.length) return prev
  const states = prev.states.slice()
  states[event.fileIndex] = event.fileState
  return { files: prev.files, states }
}

/**
 * A short label for one file in the progress list.
 *
 * The device path, minus the `/lib/` every library install shares — twenty-two
 * rows all starting with the same five characters spend the width that tells
 * them apart. A path outside `/lib` is left whole, because then the location IS
 * the information.
 */
export function installStepLabel(devicePath: string): string {
  return devicePath.startsWith('/lib/') ? devicePath.slice('/lib/'.length) : devicePath
}
