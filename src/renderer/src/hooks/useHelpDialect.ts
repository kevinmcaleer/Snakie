/**
 * WHICH PYTHON THE HELP AND COMPLETIONS TEACH (#763, epic #209).
 *
 * One hook, read by the Help panel and the editor, so the reference pages and
 * the autocomplete can never disagree about which runtime the user is on.
 *
 * It combines two things:
 *  - the board's own answer, from the session's `RuntimeInfo` (#752) — LIVE, so
 *    plugging a CircuitPython board in re-points the help at CircuitPython
 *    immediately rather than at the next restart. The dialect is a property of
 *    the thing on the desk, and connecting is the moment you learn it;
 *  - a persisted manual override, because people read the docs before they plug
 *    anything in, and because somebody writing code for a board that isn't to
 *    hand should be able to say so.
 *
 * With neither — nothing connected and no override — the answer is `unknown`,
 * which shows both runtimes side by side. It is deliberately NOT MicroPython:
 * defaulting to MicroPython is the assumption epic #209 exists to remove, and
 * the bug in #770.
 */
import { useDeviceStatus } from './useDeviceStatus'
import { useEditorSettings } from '../store/settings'
import {
  dialectSource,
  effectiveDialect,
  type DialectPreference,
  type DialectSource
} from '../../../shared/dialect-api'
import type { Dialect } from '../../../shared/dialect'

export interface HelpDialect {
  /** The runtime to teach, after applying the override. */
  dialect: Dialect
  /** What the user asked for (`'auto'` unless they overrode it). */
  preference: DialectPreference
  /** Where {@link dialect} came from, for the caption under the picker. */
  source: DialectSource
  /** What the connected board says it is, ignoring the override. */
  boardDialect: Dialect | undefined
  setPreference: (pref: DialectPreference) => void
}

/** Subscribe to the effective help/completions dialect. */
export function useHelpDialect(): HelpDialect {
  const status = useDeviceStatus()
  const { helpDialect, setHelpDialect } = useEditorSettings()
  // Only a CONNECTED board's answer counts: a stale RuntimeInfo left over from a
  // disconnected session would keep teaching a runtime that isn't there.
  const boardDialect = status.state === 'connected' ? status.runtime?.dialect : undefined
  return {
    dialect: effectiveDialect(helpDialect, boardDialect),
    preference: helpDialect,
    source: dialectSource(helpDialect, boardDialect),
    boardDialect,
    setPreference: setHelpDialect
  }
}
