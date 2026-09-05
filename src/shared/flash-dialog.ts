/**
 * DECISIONS THE FLASH DIALOG MAKES — pulled out of the component.
 * =============================================================================
 *
 * `FirmwareFlasher.tsx` is Electron-only and a thousand-odd lines of JSX, so the
 * two judgements below could not be checked without a window and a board. They
 * are the ones worth checking:
 *
 *  - **Can the board even be interrogated?** (#845) A serial port can only be
 *    open once. While Snakie holds one for the REPL, esptool cannot open it —
 *    and `identifyBoard` reports that as an EMPTY identity, which is exactly
 *    what a board that is merely not in download mode reports. So the dialog
 *    told people to hold BOOT and tap RESET, a hardware dance that cannot fix a
 *    port held by the very app asking them to do it.
 *
 *  - **What is offered once a run has finished?** (#838) A finished flash had
 *    one way out, Done, and it closed the dialog — throwing away the board, the
 *    version and every advanced option chosen to get there. After a FAILED
 *    flash, which is when you most want to change one thing and go again.
 *
 * Structural types rather than an import of the device layer's `DeviceStatus`,
 * so `shared/` stays free of a dependency on `main/` (the same reasoning as
 * `git-stage.ts`).
 */
import { isVirtualPort } from './virtual-device'

/** Just the parts of the device layer's `DeviceStatus` these decisions read. */
export interface ConnectionSnapshot {
  state: 'disconnected' | 'connecting' | 'connected' | 'error'
  path?: string
}

/**
 * The REAL serial port Snakie currently has (or is opening) for the REPL, or
 * null when it holds none.
 *
 * `connecting` counts: the port is already being opened by then, and esptool
 * loses the race just as thoroughly as it does against a settled connection.
 * The simulated device (#135) does NOT count — its `snakie://virtual` sentinel
 * is not a port and nothing is holding any hardware.
 */
export function heldSerialPort(status: ConnectionSnapshot | null | undefined): string | null {
  if (!status) return null
  if (status.state !== 'connected' && status.state !== 'connecting') return null
  if (!status.path || isVirtualPort(status.path)) return null
  return status.path
}

/** A port esptool cannot have, because Snakie is already using it. */
export interface PortConflict {
  /** The port Snakie is holding. */
  port: string
  /** One paragraph saying what is in the way and what to do about it. */
  reason: string
}

/**
 * Whether the REPL connection is standing in the way of talking to `targetPort`.
 *
 * `targetPort` is the port about to be handed to esptool. Omit it — because
 * detection recognised no serial board at all — and the held port is reported
 * anyway: a board Snakie has an open REPL to is, by definition, a board that is
 * plugged in, and "nothing found" while one demonstrably is there is the same
 * complaint wearing a different hat. Naming a DIFFERENT port is the case that
 * must NOT warn: a maker with two boards plugged in, connected to one and
 * flashing the other, has nothing in their way.
 */
export function replPortConflict(
  status: ConnectionSnapshot | null | undefined,
  targetPort?: string
): PortConflict | null {
  const held = heldSerialPort(status)
  if (!held) return null
  if (targetPort && targetPort !== held) return null
  return {
    port: held,
    reason:
      `Snakie is using ${held} for the REPL, and a serial port can only be open once — ` +
      'so esptool cannot open it to ask the board what it is. Disconnect the board and ' +
      'try again; flashing needs the port to itself too.'
  }
}

/** How a flash run ended, as the dialog tracks it. */
export type RunOutcome = 'idle' | 'success' | 'error'

/** The second way out of a finished run: back to the dialog, selections intact. */
export interface RetryAction {
  label: string
  title: string
}

/**
 * What to offer alongside Done once a run has finished (#838), or null while
 * one is still being set up — there is nothing to go back FROM yet.
 *
 * The wording splits on the outcome because the intent does. After a failure you
 * are retrying the same flash with one thing changed; after a success you are
 * almost always holding the next board.
 */
export function retryAction(outcome: RunOutcome): RetryAction | null {
  if (outcome === 'error') {
    return {
      label: '◂ Try again',
      title: 'Back to the options, with everything you chose still selected'
    }
  }
  if (outcome === 'success') {
    return {
      label: '◂ Flash another',
      title: 'Back to the options, with everything you chose still selected'
    }
  }
  return null
}
