/**
 * The simulator's language (#764): MicroPython or CircuitPython.
 *
 * A renderer preference (localStorage, like the simulator's heap in
 * sim-memory.ts) that is pushed to the device layer, which owns the simulator
 * — the main process on the desktop, a Web Worker on the web. Unlike the heap it
 * applies LIVE: the simulator just reports a different runtime, and everything
 * that follows the board follows it.
 *
 * A tiny external store rather than a context: one value, written from the
 * status bar's menu, read by the status bar.
 */
import { useSyncExternalStore } from 'react'
import { normalizeSimDialect, SIM_DIALECT_DEFAULT, type SimDialect } from '../../../shared/sim-dialect'

const STORAGE_KEY = 'snakie.sim.dialect'

function readStored(): SimDialect {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return raw === null ? SIM_DIALECT_DEFAULT : normalizeSimDialect(raw)
  } catch {
    return SIM_DIALECT_DEFAULT
  }
}

let current: SimDialect | null = null
const subs = new Set<() => void>()

/** The stored simulator language. */
export function readSimDialect(): SimDialect {
  if (current === null) current = readStored()
  return current
}

/**
 * Hand the language to the device layer. Best-effort: an older preload (or a
 * test shell) without the channel must not break anything.
 */
export async function pushSimDialect(dialect: SimDialect = readSimDialect()): Promise<void> {
  try {
    await window.api.device.setSimDialect?.(dialect)
  } catch {
    /* the simulator keeps the language it had */
  }
}

/** Choose the simulator's language: persist it, tell subscribers, push it. */
export async function setSimDialect(dialect: SimDialect): Promise<void> {
  current = normalizeSimDialect(dialect)
  try {
    window.localStorage.setItem(STORAGE_KEY, current)
  } catch {
    /* storage disabled — this session still honours it */
  }
  subs.forEach((cb) => cb())
  await pushSimDialect(current)
}

function subscribe(cb: () => void): () => void {
  subs.add(cb)
  return () => subs.delete(cb)
}

/** Subscribe to the simulator's language. */
export function useSimDialect(): SimDialect {
  return useSyncExternalStore(subscribe, readSimDialect, readSimDialect)
}
