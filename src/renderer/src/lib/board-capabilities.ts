/**
 * What the connected board's firmware can actually do (epic #634 §2.5, #806).
 *
 * The board-specific rules in §3.7 — `@micropython.native`, `@micropython.viper`,
 * inline assembler, PIO scaffolds — are only correct for *this* board with *this*
 * firmware. `@micropython.viper` is a `SyntaxError` when the emitter was not
 * compiled in, `asm_thumb` is meaningless on an Xtensa ESP32, and PIO exists only
 * on the RP2 family. Offering them blind would be worse than not offering them.
 *
 * So we ask the board, by *compiling* each decorator at run time: a missing
 * emitter fails at compile time, which makes `exec()` inside a `try` the
 * reliable test. Structure mirrors `board-packages.ts` exactly — a pure snippet
 * builder plus a pure parser, so both are unit-testable against canned REPL
 * output with no hardware in CI, and only the thin `probeBoardCapabilities()`
 * wrapper touches `window.api.device`.
 *
 * The rules the epic sets, enforced here:
 *
 * - Probe **once per connection**, cached on `(board id, machine, release)`.
 * - **No connected board ⇒ no board-specific hints.** `getCachedCapabilities()`
 *   returns undefined until a probe has succeeded, and the engine treats an
 *   absent capability set as "offer nothing" (see `capabilityAllows`).
 * - When `exec` is unavailable (a trimmed build), fall back to a static table
 *   keyed on the MCU and mark the result `inferred`, so hints hedge rather than
 *   assert.
 * - **Never infer the assembler from the MCU name.** An RP2350 boots either Arm
 *   Cortex-M33 or RISC-V Hazard3 cores, so the assembler comes from the probe or
 *   not at all.
 */
import type { BoardCapabilities } from '../../../shared/refactor/types'

/**
 * Python that reports what the firmware supports, as one JSON line.
 *
 * Each emitter is tested by `exec`ing a one-line function that uses it: if the
 * emitter was not compiled into this firmware the decorator is a compile-time
 * error, which `exec` raises and we catch. Nothing defined here is ever CALLED —
 * compiling is the whole test, and running unknown assembly on someone's robot
 * is not.
 */
export function buildCapabilityProbe(): string {
  return [
    'import json, os, gc, micropython',
    'def _ok(s):',
    '    try:',
    '        exec(s)',
    '        return True',
    '    except Exception:',
    '        return False',
    '_u = os.uname()',
    '_o = {}',
    "_o['native'] = _ok('@micropython.native\\ndef _n(): pass')",
    "_o['viper'] = _ok('@micropython.viper\\ndef _v(): pass')",
    "_o['thumb'] = _ok('@micropython.asm_thumb\\ndef _t(): nop()')",
    "_o['xtensa'] = _ok('@micropython.asm_xtensa\\ndef _x(): nop()')",
    "_o['rv32'] = _ok('@micropython.asm_rv32\\ndef _r(): nop()')",
    "_o['pio'] = _ok('import rp2\\n@rp2.asm_pio()\\ndef _p(): rp2.PIO.OUT_LOW')",
    "_o['machine'] = _u.machine",
    "_o['version'] = _u.release",
    "_o['mem'] = gc.mem_free()",
    'print(json.dumps(_o))'
  ].join('\n')
}

/** How many PIO state machines the chip has (RP2040 has 8, RP2350 has 12). */
export function stateMachineCount(machine: string): number {
  return /rp2350/i.test(machine) ? 12 : 8
}

/**
 * Parse the probe's stdout. Returns null when nothing usable came back, so the
 * caller can fall back to the static table rather than assert wrong answers.
 */
export function parseCapabilityProbe(stdout: string): BoardCapabilities | null {
  const m = /\{[\s\S]*\}/.exec(stdout)
  if (!m) return null
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(m[0]) as Record<string, unknown>
  } catch {
    return null
  }
  const bool = (key: string): boolean => raw[key] === true
  const machine = typeof raw.machine === 'string' ? raw.machine : ''
  // The assembler is read, never inferred: an RP2350 can boot Arm or RISC-V.
  const asm: BoardCapabilities['asm'] = bool('thumb')
    ? 'thumb'
    : bool('xtensa')
      ? 'xtensa'
      : bool('rv32')
        ? 'rv32'
        : null
  const pio = bool('pio')
  return {
    native: bool('native'),
    viper: bool('viper'),
    asm,
    pio,
    machine,
    version: typeof raw.version === 'string' ? raw.version : '',
    memFree: typeof raw.mem === 'number' ? raw.mem : 0,
    stateMachines: pio ? stateMachineCount(machine) : undefined
  }
}

/**
 * Last-resort capabilities from the MCU alone, marked `inferred` so the rules'
 * copy hedges ("your firmware probably supports…") instead of asserting.
 *
 * Note what is NOT inferred: `asm` is always null here. Guessing `thumb` from
 * "RP2350" would be wrong on a RISC-V boot, and a wrong assembler hint is worse
 * than none.
 */
export function staticCapabilitiesFor(mcu: string): BoardCapabilities {
  const m = mcu.toUpperCase()
  const isRp2 = m.startsWith('RP2')
  const isEsp32 = m.startsWith('ESP32')
  return {
    // The native and viper emitters are standard in the official RP2 and ESP32
    // builds; everything else we decline to guess about.
    native: isRp2 || isEsp32,
    viper: isRp2 || isEsp32,
    asm: null,
    pio: isRp2,
    machine: mcu,
    version: '',
    memFree: 0,
    inferred: true,
    stateMachines: isRp2 ? stateMachineCount(mcu) : undefined
  }
}

/** The cache key identifying one board+firmware combination. */
function cacheKey(caps: BoardCapabilities, boardId?: string): string {
  return `${boardId ?? ''}|${caps.machine}|${caps.version}`
}

let cached: { key: string; caps: BoardCapabilities } | null = null
let inFlight: Promise<BoardCapabilities | null> | null = null

/**
 * The capabilities of the currently connected board, or undefined when nothing
 * is connected or nothing has been probed yet.
 *
 * Synchronous, because the Monaco code-action provider runs on every cursor
 * move and must not await anything. Board-gated rules see `undefined` and offer
 * nothing, which is exactly the epic's rule.
 */
export function getCachedCapabilities(): BoardCapabilities | undefined {
  return cached?.caps
}

/** Forget the probe result — call on disconnect, so hints stop being offered. */
export function clearCapabilityCache(): void {
  cached = null
  inFlight = null
}

/**
 * Probe the connected board once and cache the answer. Repeat calls for the same
 * board and firmware return the cached value without touching the REPL.
 *
 * `mcu` is the board definition's MCU (`BoardDefinition.mcu`), used only for the
 * static fallback when the probe itself cannot run.
 */
export async function probeBoardCapabilities(
  boardId?: string,
  mcu?: string
): Promise<BoardCapabilities | null> {
  if (cached && (!boardId || cached.key.startsWith(`${boardId}|`))) return cached.caps
  if (inFlight) return inFlight

  inFlight = (async () => {
    try {
      const out = await window.api.device.eval(buildCapabilityProbe())
      const caps = parseCapabilityProbe(out)
      if (caps) {
        cached = { key: cacheKey(caps, boardId), caps }
        return caps
      }
    } catch {
      // Falls through to the static table below.
    }
    if (mcu) {
      const caps = staticCapabilitiesFor(mcu)
      cached = { key: cacheKey(caps, boardId), caps }
      return caps
    }
    return null
  })()

  try {
    return await inFlight
  } finally {
    inFlight = null
  }
}
