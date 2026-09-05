import { describe, it, expect } from 'vitest'
import { MicroPythonRuntime } from '../src/main/device/MicroPythonRuntime'
import { SimulatedDevice } from '../src/main/device/SimulatedDevice'
import type { ReplRuntime } from '../src/main/device/MicroPythonRuntime'
import { SIM_HEAP_DEFAULT_BYTES } from '../src/shared/sim-memory'

/**
 * The simulated board's heap setting, against the REAL interpreter (#901).
 *
 * These load MicroPython for real (in the worker the vitest globalSetup
 * compiles), because the whole question the issue asks — "if the wasm allows
 * it" — can only be answered by the interpreter itself. Asserting on a mock
 * would prove we send a message, not that the heap changes.
 *
 * What is asserted is deliberately narrow, and matches what the WASM build
 * actually does: with a small heap a large allocation fails on its FIRST
 * attempt, and with the default heap the same allocation succeeds. It is not
 * asserted that the small heap caps total memory — it does not. The build grows
 * its heap on demand, so the retry succeeds; that is exactly why the dialog
 * calls this a starting heap rather than a limit.
 */

/** Ask the interpreter to make one big allocation, and report what happened. */
const tryBigAlloc = async (rt: MicroPythonRuntime): Promise<string> =>
  rt.runCaptured(
    [
      'try:',
      '    _b = bytearray(600 * 1024)',
      '    print("ALLOCATED")',
      '    del _b',
      'except MemoryError:',
      '    print("MEMORYERROR")'
    ].join('\n')
  )

describe('simulated device heap (real WebAssembly)', () => {
  it('a small starting heap makes a big first allocation fail', async () => {
    const rt = new MicroPythonRuntime()
    await rt.init(() => {}, 64 * 1024)
    expect(await tryBigAlloc(rt)).toContain('MEMORYERROR')
    rt.dispose()
  }, 30000)

  it('the default heap lets the same allocation through', async () => {
    const rt = new MicroPythonRuntime()
    await rt.init(() => {}, SIM_HEAP_DEFAULT_BYTES)
    expect(await tryBigAlloc(rt)).toContain('ALLOCATED')
    rt.dispose()
  }, 30000)

  it('a small heap still boots a usable REPL, machine module and all', async () => {
    // A tight heap must not cost the lesson-critical `from machine import Pin`
    // — the sim seeds that stub at boot, and it allocates.
    const rt = new MicroPythonRuntime()
    const out: Buffer[] = []
    await rt.init((c) => out.push(c), 64 * 1024)
    await rt.feed('from machine import Pin\rp = Pin(25, Pin.OUT)\rp.on()\rprint("pinval", p.value())\r')
    await new Promise((r) => setTimeout(r, 120))
    const text = Buffer.concat(out).toString('utf8')
    expect(text).toContain('pinval 1')
    expect(text).not.toContain('ImportError')
    rt.dispose()
  }, 30000)

  it('the Stop reboot brings the SAME heap back, not the default', async () => {
    // Stop terminates and re-spawns the worker; if the heap were only passed on
    // the first spawn, one Stop would silently hand the user a 1 MB board back.
    const rt = new MicroPythonRuntime()
    await rt.init(() => {}, 64 * 1024)
    const running = rt.feed('\x05import time\r\nwhile True:\r\n    time.sleep_ms(20)\r\n\x04').catch(() => undefined)
    await new Promise((r) => setTimeout(r, 400))
    await rt.interrupt() // busy → reboot
    await running
    expect(await tryBigAlloc(rt)).toContain('MEMORYERROR')
    rt.dispose()
  }, 30000)
})

/** Records what heap the device asked its runtime to boot with. */
class RecordingRuntime implements ReplRuntime {
  heapBytes: number | undefined
  async init(_onOutput: (chunk: Buffer) => void, heapBytes?: number): Promise<void> {
    this.heapBytes = heapBytes
  }
  async feed(): Promise<void> {}
  async runCaptured(): Promise<string> {
    return ''
  }
  async runStream(): Promise<void> {}
  async interrupt(): Promise<void> {}
  dispose(): void {}
}

describe('SimulatedDevice memory setting', () => {
  it('boots the interpreter with the configured heap', async () => {
    const runtime = new RecordingRuntime()
    const dev = new SimulatedDevice(runtime)
    dev.setMemory(128 * 1024)
    await dev.connect()
    expect(runtime.heapBytes).toBe(128 * 1024)
    await dev.disconnect()
  })

  it('defaults to the WASM port’s own 1 MB heap', async () => {
    const runtime = new RecordingRuntime()
    const dev = new SimulatedDevice(runtime)
    await dev.connect()
    expect(runtime.heapBytes).toBe(SIM_HEAP_DEFAULT_BYTES)
    await dev.disconnect()
  })

  it('clamps a nonsense setting rather than passing it to mp_js_init', async () => {
    const runtime = new RecordingRuntime()
    const dev = new SimulatedDevice(runtime)
    dev.setMemory(-1)
    await dev.connect()
    expect(runtime.heapBytes).toBe(SIM_HEAP_DEFAULT_BYTES)
    await dev.disconnect()
  })

  it('reports configured vs booted, so the UI knows a restart is owed', async () => {
    const dev = new SimulatedDevice(new RecordingRuntime())
    expect(dev.getMemory()).toEqual({ configured: SIM_HEAP_DEFAULT_BYTES, booted: null })

    dev.setMemory(192 * 1024)
    await dev.connect()
    expect(dev.getMemory()).toEqual({ configured: 192 * 1024, booted: 192 * 1024 })

    // Changing it while connected must NOT claim the live interpreter moved.
    dev.setMemory(32 * 1024)
    expect(dev.getMemory()).toEqual({ configured: 32 * 1024, booted: 192 * 1024 })

    await dev.disconnect()
    expect(dev.getMemory()).toEqual({ configured: 32 * 1024, booted: null })
  })
})
