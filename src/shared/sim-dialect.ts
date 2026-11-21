/**
 * WHICH PYTHON THE SIMULATOR SPEAKS — MicroPython or CircuitPython (#764).
 * =============================================================================
 *
 * The simulator is always the MicroPython WebAssembly port underneath, and since
 * #1344 it also carries CircuitPython's core modules (`board`, `digitalio`, …,
 * see sim-circuitpython.ts). So both kinds of program already run. What this
 * setting changes is what the simulator SAYS it is: the `RuntimeInfo` on its
 * device status. Everything that follows the board — the status bar, the help
 * and completions, the Run/Reset wording, the file tree's `code.py` badge, the
 * Modules panel — reads that, so flipping it moves them all together, with no
 * reboot.
 *
 * Dependency-free so main, preload, the web worker host and the renderer can all
 * import it.
 */
import type { RuntimeInfo } from './dialect'

/** The Pythons the simulator can present as. */
export type SimDialect = 'micropython' | 'circuitpython'

export const SIM_DIALECT_DEFAULT: SimDialect = 'micropython'

/** Coerce anything (a stored value, an IPC argument) to a {@link SimDialect}. */
export function normalizeSimDialect(value: unknown): SimDialect {
  return value === 'circuitpython' ? 'circuitpython' : 'micropython'
}

/**
 * The runtime the simulator reports. No version and no board id, on purpose:
 * the update checks compare those against firmware catalogs, and a simulator
 * has no firmware to update.
 */
export function simRuntimeInfo(dialect: SimDialect): RuntimeInfo {
  return { dialect }
}

/**
 * The line the console shows when the simulator changes language while it is
 * running (and after it boots as CircuitPython), so the REPL says what it
 * speaks. Starts on a fresh line and ends on a prompt.
 */
export function simDialectNotice(dialect: SimDialect): string {
  return dialect === 'circuitpython'
    ? '\r\nSimulator: CircuitPython mode. board, digitalio, pwmio, analogio, busio and\r\n' +
        'microcontroller are ready, with Raspberry Pi Pico pins (board.GP0, board.LED).\r\n>>> '
    : '\r\nSimulator: MicroPython mode.\r\n>>> '
}
