/**
 * The status bar's runtime item: what it says, and what its menu offers.
 *
 * It used to only REPORT the connected board's runtime. It is now where you
 * choose the Python you are writing for:
 *
 *  - **On the simulator** it switches the simulator itself between MicroPython
 *    and CircuitPython (#764). The simulator then reports that runtime, so the
 *    help, completions, Run/Reset wording and file badges all follow it.
 *  - **With nothing connected** it picks the simulator's language for its next
 *    start AND pins the help and completions to it, so you can read and write
 *    for that Python straight away.
 *  - **On a real board** the board's firmware decides what runs, so the menu
 *    offers the help/completions override (the same setting as the Help panel's
 *    pills, `snakie.help.dialect`), and, rather than a dead option, the two next
 *    steps for the other Python: flash it onto the board, or try it on the
 *    simulator.
 *
 * Kept free of React so the wording and the menu are unit-tested.
 */
import { DIALECT_LABEL, type Dialect } from '../../../shared/dialect'
import type { SimDialect } from '../../../shared/sim-dialect'
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

/** The status bar item when the SIMULATOR is the connected board. */
export function simSwitcherView(
  preference: DialectPreference,
  simDialect: SimDialect
): RuntimeSwitcherView {
  const sim = DIALECT_LABEL[simDialect]
  const other = DIALECT_LABEL[simDialect === 'micropython' ? 'circuitpython' : 'micropython']
  if (preference !== 'auto' && preference !== simDialect) {
    const pinned = DIALECT_PREFERENCE_LABEL[preference]
    return {
      label: `${pinned} hints`,
      title: `The simulator runs ${sim}, but help and completions are set to ${pinned}. Click to change.`,
      mismatch: true
    }
  }
  return {
    label: sim,
    title: `The simulator runs ${sim}. Click to switch it to ${other}.`,
    mismatch: false
  }
}

/** Where the status bar's item is pointing. */
export type SwitcherTarget = 'simulator' | 'board' | 'none'

/** What a menu row does — data, so the menu is testable without React. */
export type SwitcherAction =
  /** Switch the running simulator; help and completions go back to following it. */
  | { kind: 'sim'; dialect: SimDialect }
  /** Nothing connected: the simulator's next language AND the hints. */
  | { kind: 'prefer'; dialect: SimDialect }
  /** Only the help/completions setting. */
  | { kind: 'hints'; pref: DialectPreference }
  /** Open the firmware flasher on this Python. */
  | { kind: 'flash'; dialect: SimDialect }
  /** Connect the simulator, speaking this Python. */
  | { kind: 'try-sim'; dialect: SimDialect }

export interface SwitcherRow {
  key: string
  label: string
  /** The row that is in force now (shown with a tick). */
  checked: boolean
  action: SwitcherAction
}

const PYTHONS: SimDialect[] = ['micropython', 'circuitpython']

/**
 * The menu's rows. Every row does something: there is no greyed-out
 * "CircuitPython" on a MicroPython board — that row says what to do instead.
 */
export function switcherRows(
  target: SwitcherTarget,
  preference: DialectPreference,
  simDialect: SimDialect,
  boardDialect: Dialect | undefined
): SwitcherRow[] {
  if (target === 'simulator') {
    return PYTHONS.map((d) => ({
      key: `sim-${d}`,
      label: DIALECT_LABEL[d],
      checked: d === simDialect,
      action: { kind: 'sim', dialect: d }
    }))
  }
  if (target === 'none') {
    return [
      ...PYTHONS.map(
        (d): SwitcherRow => ({
          key: `prefer-${d}`,
          label: DIALECT_LABEL[d],
          checked: preference === d,
          action: { kind: 'prefer', dialect: d }
        })
      ),
      {
        key: 'hints-auto',
        label: 'Auto (follow the board)',
        checked: preference === 'auto',
        action: { kind: 'hints', pref: 'auto' }
      }
    ]
  }
  const rows: SwitcherRow[] = [
    {
      key: 'hints-auto',
      label: 'Auto (follow the board)',
      checked: preference === 'auto',
      action: { kind: 'hints', pref: 'auto' }
    },
    ...PYTHONS.map(
      (d): SwitcherRow => ({
        key: `hints-${d}`,
        label: `${DIALECT_LABEL[d]} hints`,
        checked: preference === d,
        action: { kind: 'hints', pref: d }
      })
    )
  ]
  // The board runs one Python; offer the way to the other.
  const others = PYTHONS.filter((d) => d !== boardDialect)
  for (const d of boardDialect === 'micropython' || boardDialect === 'circuitpython' ? others : []) {
    rows.push(
      {
        key: `flash-${d}`,
        label: `Put ${DIALECT_LABEL[d]} on this board…`,
        checked: false,
        action: { kind: 'flash', dialect: d }
      },
      {
        key: `try-${d}`,
        label: `Try ${DIALECT_LABEL[d]} on the simulator`,
        checked: false,
        action: { kind: 'try-sim', dialect: d }
      }
    )
  }
  return rows
}
