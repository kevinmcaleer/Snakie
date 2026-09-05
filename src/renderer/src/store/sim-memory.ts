/**
 * Simulated-device memory setting (#901) — persistence + push to the device layer.
 *
 * The heap the simulator boots with is a RENDERER preference (it lives in
 * localStorage with the rest of the UI state), but the interpreter is booted by
 * the device layer — the main process on the desktop, a Web Worker on the web.
 * So the value has to be pushed across whenever it changes, and once at startup
 * so a preference set in an earlier session is in force before anything
 * auto-connects.
 *
 * Deliberately plain functions rather than a context: there is one number, it is
 * read at boot time, and the dialog that edits it is the only writer.
 */
import { clampSimHeapBytes, SIM_HEAP_DEFAULT_BYTES } from '../../../shared/sim-memory'

const STORAGE_KEY = 'snakie.simHeapBytes'

/**
 * The stored heap preference, clamped. Anything unreadable or corrupt falls back
 * to the default — a bad stored value must never stop the simulator booting.
 */
export function readSimHeapBytes(): number {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw === null) return SIM_HEAP_DEFAULT_BYTES
    return clampSimHeapBytes(JSON.parse(raw))
  } catch {
    return SIM_HEAP_DEFAULT_BYTES
  }
}

/** Persist the preference. Returns the clamped value actually stored. */
export function writeSimHeapBytes(bytes: number): number {
  const clamped = clampSimHeapBytes(bytes)
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(clamped))
  } catch {
    // Storage disabled / full — the value still reaches the device layer below,
    // so the current session honours it even if the next one won't.
  }
  return clamped
}

/**
 * Hand the preference to the device layer so the simulator's NEXT boot uses it.
 * Best-effort: an older preload without the channel must not break the console.
 */
export async function pushSimHeapBytes(bytes: number): Promise<void> {
  try {
    await window.api.device.setSimMemory?.(bytes)
  } catch {
    /* the simulator simply keeps the heap it already had */
  }
}
