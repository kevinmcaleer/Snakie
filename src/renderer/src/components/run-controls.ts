/**
 * WHAT RUN, STOP AND RESET MEAN ON EACH RUNTIME (#755, epic #209).
 * =============================================================================
 *
 * MicroPython runs what Snakie sends it and nothing else. CircuitPython runs
 * `code.py` from boot and reloads it whenever a file changes — so the same three
 * buttons do materially different things, and the difference is invisible
 * unless the app says so.
 *
 * Pure and unit-tested (the `updateButton.ts` pattern): the wording is the whole
 * deliverable here, so it is worth pinning rather than burying in JSX.
 *
 * **Run stays a raw-REPL exec on both runtimes.** The alternative — write the
 * file to `code.py` and let auto-reload run it — was rejected: it would overwrite
 * a file the user did not ask us to touch, and it would make Run mean something
 * different from what it means everywhere else in Snakie. What changes is only
 * the explanation: on CircuitPython, running takes over from `code.py`, and when
 * it finishes the board is sitting at the REPL rather than back in `code.py`.
 */
import type { Dialect } from '../../../shared/dialect'

/** Everything the Run button's tooltip depends on. */
export interface RunTitleState {
  /** Name of the file that would run; absent when no file is open. */
  activeFileName?: string
  connected: boolean
  connecting: boolean
  /** Which Python the board runs — absent until the connect probe answers. */
  dialect?: Dialect
}

/** Everything the Stop/Reset button's tooltip depends on. */
export interface StopTitleState {
  connected: boolean
  /** True while a program Snakie started is still going. */
  running: boolean
  dialect?: Dialect
}

/**
 * The Run button's tooltip.
 *
 * The CircuitPython wording names the consequence a user cannot otherwise
 * predict: their `code.py` stops, and it does not come back on its own.
 */
export function runTitle(s: RunTitleState): string {
  if (!s.activeFileName) return 'Open a file to run'
  if (s.connecting) return 'Connecting…'
  if (!s.connected) return 'Run on the simulator'
  if (s.dialect === 'circuitpython') {
    return `Run ${s.activeFileName} on the board. It takes over from code.py, and the board stays at the REPL afterwards rather than going back to it — press Reset to run code.py again.`
  }
  return `Run ${s.activeFileName} on the device`
}

/**
 * The Stop/Reset button's tooltip.
 *
 * Reset is where the runtimes genuinely differ: Ctrl-D soft-reboots both, but on
 * CircuitPython a soft reboot **re-runs `code.py`**, so the button is not the
 * "clear the board's state" it is on MicroPython — it starts the user's program.
 */
export function stopTitle(s: StopTitleState): string {
  if (!s.connected) return 'Connect to a device to stop'
  if (s.running) return 'Interrupt the running program (Ctrl-C)'
  if (s.dialect === 'circuitpython') {
    return 'Reset the board (soft reboot) — CircuitPython runs code.py again from the start'
  }
  return 'Reset the board (soft reboot)'
}

/**
 * Which of a runtime's two startup stages a file belongs to (#872).
 *
 * `boot` is the setup pass; `main` is the program. Two stages rather than one
 * flat list because that is the shape of the real thing, and because they answer
 * different questions for the reader: "what runs before my code" versus "which
 * file IS my code".
 */
export type BootStage = 'boot' | 'main'

/**
 * The files each runtime runs by itself, per stage, in the order it looks for
 * them. Within a stage the FIRST name present wins and the rest are ignored,
 * which is the trap this exists to surface — a CircuitPython board carrying both
 * `code.py` and `main.py` runs only `code.py`, and editing `main.py` then
 * appears to do nothing.
 *
 * Both lists are taken from the runtimes' own C, not from a guide:
 *
 * - CircuitPython `main.c` — `boot_py_filenames[] = {"boot.py", "boot.txt"}`
 *   and `supported_filenames[] = {"code.txt", "code.py", "main.py", "main.txt"}`.
 *   Note `main.py` BEFORE `main.txt`: Adafruit's own learn guide prints them the
 *   other way round ("code.txt, code.py, main.txt and main.py … in that order"),
 *   and that is where this table's previous ordering came from. The source is
 *   what actually runs on the board, so the source wins.
 * - MicroPython `ports/rp2/main.c` — `pyexec_file_if_exists("boot.py")` and then
 *   `pyexec_file_if_exists("main.py")`. BOTH run, every reset; there is no
 *   shadowing between the two and no `.txt` form.
 */
export const BOOT_FILE_ORDER: Record<
  'circuitpython' | 'micropython',
  Record<BootStage, string[]>
> = {
  circuitpython: {
    boot: ['boot.py', 'boot.txt'],
    main: ['code.txt', 'code.py', 'main.py', 'main.txt']
  },
  micropython: {
    boot: ['boot.py'],
    main: ['main.py']
  }
}

/**
 * Which file in a device directory listing the board will actually run for a
 * given stage, or `null` when it will run none of them.
 *
 * `names` should be the ROOT listing — the boot files are only boot files there.
 * Returns the winner of the runtime's own search order, so a board carrying both
 * `code.py` and `main.py` names `code.py`.
 */
export function bootFile(
  names: string[],
  dialect?: Dialect,
  stage: BootStage = 'main'
): string | null {
  if (dialect !== 'circuitpython' && dialect !== 'micropython') return null
  const present = new Set(names)
  return BOOT_FILE_ORDER[dialect][stage].find((f) => present.has(f)) ?? null
}

/** The device-tree marker for one file: what it says, and what it means. */
export interface BootRole {
  /** Badge text. Short — it sits at the end of a tree row. */
  label: string
  /** Tooltip: what the board actually does with this file, and when. */
  title: string
  /** The runtime will skip this file because another one comes first. */
  shadowed: boolean
}

/**
 * What the SETUP file is for, per runtime. This is the half a file listing can
 * never show, and the two runtimes are genuinely different here — so a single
 * "runs at boot" sentence for both would be the "assume MicroPython everywhere"
 * default that epic #209 exists to remove.
 */
const BOOT_STAGE_NOTE: Record<'circuitpython' | 'micropython', string> = {
  micropython:
    'MicroPython runs this file first at every reset, before main.py. It is for setup — mounting storage, joining Wi-Fi — rather than for your program.',
  circuitpython:
    'CircuitPython runs this file once at power-on, before USB is set up — which is why settings like a writable CIRCUITPY drive can only be changed here. Resetting the board re-runs code.py but NOT this file.'
}

/**
 * The role a file in the root plays at startup — the marker in the device file
 * tree, and the tooltip that explains it. `null` for a file that has nothing to
 * say, which is most of them.
 *
 * `null` is also the answer whenever the runtime is not known (no board, or a
 * probe that could not name one). Guessing MicroPython would put a confident
 * "runs at boot" on a `main.py` that a CircuitPython board may well ignore —
 * exactly the wrong-by-default that #209 is about. Silence is the safe answer.
 */
export function bootRoleFor(name: string, names: string[], dialect?: Dialect): BootRole | null {
  if (dialect !== 'circuitpython' && dialect !== 'micropython') return null
  const order = BOOT_FILE_ORDER[dialect]
  // The two lists are disjoint, so the first match is the only match.
  const stage: BootStage | null = order.boot.includes(name)
    ? 'boot'
    : order.main.includes(name)
      ? 'main'
      : null
  if (!stage) return null

  const runtime = dialect === 'circuitpython' ? 'CircuitPython' : 'MicroPython'
  // Shadowing is per-stage: a `boot.py` never hides a `main.py`, because on both
  // runtimes the setup file and the program are separate passes that both run.
  const winner = bootFile(names, dialect, stage)
  if (name !== winner) {
    return {
      label: 'ignored',
      title: `${runtime} runs ${winner} instead — it comes first, so this file is ignored`,
      shadowed: true
    }
  }
  if (stage === 'boot') {
    return { label: 'runs first', title: BOOT_STAGE_NOTE[dialect], shadowed: false }
  }
  // Name the setup file rather than hardcoding `boot.py`: on CircuitPython the
  // board may be running a `boot.txt` instead.
  const setup = bootFile(names, dialect, 'boot')
  return {
    label: 'runs at boot',
    title: `${runtime} runs this file when the board starts${setup ? `, after ${setup}` : ''}`,
    shadowed: false
  }
}
