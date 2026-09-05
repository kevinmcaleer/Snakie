/**
 * SIMULATED-DEVICE MEMORY — how much heap the virtual board boots with (#901).
 * =============================================================================
 *
 * The simulator runs the official MicroPython WebAssembly port, and
 * `loadMicroPython()` accepts a `heapsize` which it hands straight to
 * `mp_js_init(pystack, heapsize)` — so the GC heap the interpreter starts with
 * IS ours to choose. That is the knob this module describes.
 *
 * What it is NOT — and the UI says so, because getting this wrong would be worse
 * than having no setting at all:
 *
 *  - **It is a starting heap, not a ceiling.** This build auto-grows the GC heap
 *    (MicroPython's split-heap auto mode): when an allocation doesn't fit, the
 *    GC mallocs another region and the NEXT attempt succeeds. Measured against
 *    the bundled 1.28.0 build with a 64 KB heap, `bytearray(300*1024)` raises
 *    MemoryError on the first try and then succeeds on the second, third and
 *    fourth — growing well past the configured size. So a small heap reproduces
 *    the *first-allocation* failure a tight board gives you, but it will not
 *    starve a program that allocates gradually, and it cannot make the simulator
 *    run out of memory the way real hardware does.
 *
 *  - **It is not what `gc.mem_free()` reports.** The WASM port reports the
 *    linear memory's headroom (~128 MB) regardless of `heapsize`, so
 *    `gc.mem_free()` on the simulator answers a different question than it does
 *    on a board. Naming the configured heap in the dialog is what makes that
 *    number explicable.
 *
 * Everything here is pure so the decisions are unit-tested without Electron, a
 * DOM or a WebAssembly load.
 */

/** The MicroPython WASM port's own default heap (1 MB) — our default too. */
export const SIM_HEAP_DEFAULT_BYTES = 1024 * 1024

/** Smallest heap offered. It boots below this, but the REPL stops being usable. */
export const SIM_HEAP_MIN_BYTES = 16 * 1024

/** Largest heap offered. Past this the setting stops meaning anything useful. */
export const SIM_HEAP_MAX_BYTES = 64 * 1024 * 1024

/** A named starting heap, sized in the region of some real board's free RAM. */
export interface SimHeapPreset {
  id: string
  label: string
  bytes: number
  /** What this is roughly like on real hardware — deliberately hedged. */
  hint: string
}

/**
 * The offered heaps. The hints say "roughly" and mean it: a board's free heap
 * moves with its firmware build, and (per the note above) this is the heap the
 * simulator STARTS with rather than a cap, so none of these is an emulation of
 * the named board — just a comparable starting point.
 */
export const SIM_HEAP_PRESETS: readonly SimHeapPreset[] = [
  {
    id: 'esp8266',
    label: 'Very tight — 32 KB',
    bytes: 32 * 1024,
    hint: 'Roughly an ESP8266. A big buffer fails on its first allocation.'
  },
  {
    id: 'esp32',
    label: 'Tight — 128 KB',
    bytes: 128 * 1024,
    hint: 'Roughly an ESP32 with its PSRAM switched off.'
  },
  {
    id: 'pico',
    label: 'Small — 192 KB',
    bytes: 192 * 1024,
    hint: 'Roughly a Pico / RP2040 after MicroPython has booted.'
  },
  {
    id: 'default',
    label: 'Default — 1 MB',
    bytes: SIM_HEAP_DEFAULT_BYTES,
    hint: "The MicroPython WASM port's own default. Nothing fails for size."
  },
  {
    id: 'psram',
    label: 'Roomy — 8 MB',
    bytes: 8 * 1024 * 1024,
    hint: 'Roughly an ESP32 with its PSRAM working.'
  }
] as const

/**
 * Coerce anything (a corrupt localStorage value, a half-typed number field) into
 * a heap size the interpreter will accept: a whole number of KB inside the
 * offered range. Garbage falls back to the default rather than throwing — a bad
 * stored value must never stop the simulator booting.
 */
export function clampSimHeapBytes(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n) || n <= 0) return SIM_HEAP_DEFAULT_BYTES
  // Whole KB — `mp_js_init` takes a byte count, but an odd byte figure in the UI
  // reads as false precision for a number this approximate.
  const kb = Math.round(n / 1024)
  const bytes = kb * 1024
  if (bytes < SIM_HEAP_MIN_BYTES) return SIM_HEAP_MIN_BYTES
  if (bytes > SIM_HEAP_MAX_BYTES) return SIM_HEAP_MAX_BYTES
  return bytes
}

/** Render a heap size the way the presets read: "192 KB", "1 MB", "1.5 MB". */
export function formatSimHeap(bytes: number): string {
  const mb = bytes / (1024 * 1024)
  if (mb >= 1) {
    // Trim a trailing ".0" so a round figure doesn't read as a measurement.
    const text = mb.toFixed(1).replace(/\.0$/, '')
    return `${text} MB`
  }
  return `${Math.round(bytes / 1024)} KB`
}

/** The preset a heap size corresponds to exactly, or null for a custom size. */
export function simHeapPresetFor(bytes: number): SimHeapPreset | null {
  return SIM_HEAP_PRESETS.find((p) => p.bytes === bytes) ?? null
}

/**
 * Does the running interpreter still need restarting to pick `wanted` up?
 *
 * The heap is fixed at `mp_js_init`, so a change only lands when the interpreter
 * is re-instantiated. `booted` is what the live simulator actually started with
 * (null when nothing is running — then there is nothing to restart).
 */
export function simHeapNeedsRestart(booted: number | null, wanted: number): boolean {
  return booted !== null && booted !== wanted
}
