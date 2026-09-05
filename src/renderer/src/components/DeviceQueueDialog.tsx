import { useEffect, useState, useSyncExternalStore } from 'react'
import {
  cancelDeviceQueue,
  dismissDeviceQueue,
  minimiseDeviceQueue,
  getDeviceQueueSnapshot,
  queueDialogAction,
  queueProgress,
  queueRows,
  queueTitle,
  subscribeDeviceQueue
} from '../lib/device-queue'
import { TransferProgressDialog } from './TransferProgressDialog'

/**
 * THE BOARD-IS-BUSY MODAL (#837).
 *
 * Thonny puts a modal up while it writes to the board, and it is the right
 * answer: a serial file operation is slow, most of the app cannot be used
 * meanwhile, and a UI that stays fully live while secretly refusing to work is
 * the thing that reads as broken. So this covers the app for as long as the
 * device queue has work — showing what is running, what is waiting behind it,
 * and a Cancel that hands the app straight back.
 *
 * Two timing rules keep it from becoming a nuisance:
 *  - it waits {@link SHOW_AFTER_MS} before appearing, so uploading one small
 *    file does not flash a dialog on and off;
 *  - it dismisses itself shortly after the last task succeeds (the dialog's own
 *    behaviour), and stays put on failure.
 *
 * It is mounted in BOTH renderer entries — the main window and the popped-out
 * Board View — because each has its own queue, and the Board View's driver
 * banner installs from over there.
 */

/** How long the board must be busy before the modal is worth showing. */
export const SHOW_AFTER_MS = 400

export function DeviceQueueDialog(): JSX.Element | null {
  const snap = useSyncExternalStore(
    subscribeDeviceQueue,
    getDeviceQueueSnapshot,
    getDeviceQueueSnapshot
  )
  const [onScreen, setOnScreen] = useState(false)
  // Minimised state is the QUEUE's now, not this component's (#890): the round
  // trip has two ends, and the status-bar popup owns the other one.
  const action = queueDialogAction(snap, onScreen)

  useEffect(() => {
    if (action === 'hide') {
      setOnScreen(false)
      return
    }
    if (action === 'show') {
      setOnScreen(true)
      return
    }
    if (action === 'clear') {
      // Finished before anyone saw it. Drop the rows now, or they would turn up
      // as history in front of the next operation.
      dismissDeviceQueue()
      return
    }
    const t = setTimeout(() => setOnScreen(true), SHOW_AFTER_MS)
    return () => clearTimeout(t)
  }, [action])

  // Minimised and nothing new since. The board is still working, and the
  // status-bar indicator is what says so from here — with a maximise that
  // brings this back.
  if (snap.minimised || !onScreen || snap.tasks.length === 0) return null

  return (
    <TransferProgressDialog
      title={queueTitle(snap.tasks)}
      rows={queueRows(snap.tasks)}
      progress={queueProgress(snap.tasks)}
      running={snap.busy}
      error={snap.error}
      onCancel={cancelDeviceQueue}
      minimiseLabel={snap.busy ? 'Minimise' : undefined}
      onClose={() => {
        // Close means two different things depending on whether the board is
        // still working: tidy away a finished run, or minimise one that is still
        // going. Both are "I am done looking at this".
        if (snap.busy) minimiseDeviceQueue()
        else dismissDeviceQueue()
      }}
    />
  )
}
