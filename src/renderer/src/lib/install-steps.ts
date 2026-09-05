/**
 * AN INSTALL, AS THE DEVICE QUEUE'S STEPS (#895).
 * =============================================================================
 *
 * The queue (#837) gives every task a list of sub-steps it can tick off, and
 * the folder copy (#848) uses it: twelve files, twelve rows, each going pending
 * → copying → done as it lands. A library install had exactly the same shape and
 * used none of it. It was enqueued as ONE task whose `run` never called
 * `ctx.setSteps`, so a Modulino install — 22 files plus three dependency
 * packages, minutes over the raw REPL — showed a single motionless row for the
 * whole thing. That is the reported bug: it looks like a hang, and the
 * documented response to a hang is Disconnect, which mid-write is precisely
 * what #864 exists to stop being destructive.
 *
 * The writer now reports the same facts structurally (see
 * `shared/install-file-progress.ts`), so this is the whole adaptation: a
 * progress callback that forwards the events on and turns them into step calls.
 *
 * Kept here rather than in `device-queue.ts` because the queue knows nothing
 * about installs, and rather than in each panel because there are six callers
 * and they should not each re-derive it.
 */
import { installStepLabels, type InstallFileProgress } from '../../../shared/install-file-progress'
import type { DeviceTaskContext } from './device-queue'

/**
 * A progress callback that ticks `ctx`'s steps off file by file.
 *
 * `onEvent` is the caller's own handler, called for every event first — the
 * panels collect `note` messages for their install log, and taking the queue's
 * reporting must not cost them that.
 *
 * `fileIndex` indexes the file list, and the labels are built one-per-file from
 * it, so it indexes the steps too; `ctx.step` ignores anything out of range,
 * which is what makes an event arriving before its list harmless.
 */
export function installStepReporter<P extends InstallFileProgress>(
  ctx: DeviceTaskContext,
  onEvent?: (event: P) => void
): (event: P) => void {
  return (event: P): void => {
    onEvent?.(event)
    if (event.files) {
      ctx.setSteps(installStepLabels(event.files))
      return
    }
    if (event.fileIndex === undefined || event.fileState === undefined) return
    ctx.step(event.fileIndex, event.fileState)
  }
}
