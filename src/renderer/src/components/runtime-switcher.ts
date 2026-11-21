/**
 * The status bar's runtime item: what it says, and what its menu offers.
 *
 * It used to only REPORT the connected board's runtime. It is now also where you
 * choose which Python the help and editor completions teach — the same setting
 * as the pills at the top of the Help panel (`snakie.help.dialect`), so the two
 * can never disagree. Kept free of React so the wording is unit-tested.
 */
import { DIALECT_LABEL, type Dialect } from '../../../shared/dialect'
import { DIALECT_PREFERENCE_LABEL, type DialectPreference } from '../../../shared/dialect-api'

export interface RuntimeSwitcherView {
  /** The text on the status bar. */
  label: string
  /** The tooltip. */
  title: string
  /** True when the hints are pinned to a different Python than the board runs. */
  mismatch: boolean
}

/**
 * @param preference  The help/completions setting.
 * @param boardDialect The connected board's dialect, or undefined when nothing
 *                     is connected (or the probe hasn't answered).
 * @param runtimeText  The board's runtime as the status bar already words it
 *                     (`MicroPython 1.28.0`), or '' when there is none.
 */
export function runtimeSwitcherView(
  preference: DialectPreference,
  boardDialect: Dialect | undefined,
  runtimeText: string
): RuntimeSwitcherView {
  const board = boardDialect && boardDialect !== 'unknown' ? DIALECT_LABEL[boardDialect] : null
  const pickHint = 'Click to choose MicroPython or CircuitPython help and completions.'
  if (preference === 'auto') {
    return {
      label: runtimeText || 'Auto',
      title: board
        ? `The board runs ${board}; help and completions follow it. ${pickHint}`
        : `No board has said which Python it runs, so help and completions show both. ${pickHint}`,
      mismatch: false
    }
  }
  const pinned = DIALECT_PREFERENCE_LABEL[preference]
  const mismatch = !!board && boardDialect !== preference
  return {
    label: mismatch ? `${pinned} hints` : board && runtimeText ? runtimeText : pinned,
    title: mismatch
      ? `Help and completions are set to ${pinned}, but the board runs ${board}. Click to change.`
      : `Help and completions are set to ${pinned}. Click to change.`,
    mismatch
  }
}

/** The menu rows, in order: Auto first, then each Python. */
export const RUNTIME_CHOICES: { pref: DialectPreference; label: string }[] = [
  { pref: 'auto', label: 'Auto (follow the board)' },
  { pref: 'micropython', label: 'MicroPython' },
  { pref: 'circuitpython', label: 'CircuitPython' }
]
