import { describe, it, expect } from 'vitest'
import { MicroPythonRuntime } from '../src/main/device/MicroPythonRuntime'

/**
 * Integration test for the REAL MicroPython WebAssembly runtime (issue #135) —
 * this actually loads + runs the interpreter (in a worker_threads worker, so a
 * `while True:` can't freeze the process), proving the offline device executes
 * Python. The worker is compiled by the vitest globalSetup and located via
 * `SNAKIE_MP_WORKER`. Generous timeouts cover the one-off WASM load.
 */
describe('MicroPythonRuntime (real WebAssembly)', () => {
  it('runs a hello-world program via paste mode and streams its output', async () => {
    const rt = new MicroPythonRuntime()
    const out: Buffer[] = []
    await rt.init((c) => out.push(c))

    // Exactly what the Run button sends: Ctrl-E (paste mode) … Ctrl-D (execute).
    const program = 'print("Hello, World!")\nfor i in range(3):\n    print("n", i)\n'
    await rt.feed('\x05' + program + '\x04')
    await new Promise((r) => setTimeout(r, 50)) // let the flush drain

    const text = Buffer.concat(out).toString('utf8')
    expect(text).toContain('Hello, World!')
    expect(text).toContain('n 2')
    rt.dispose()
  }, 30000)

  it('evaluates expressions interactively', async () => {
    const rt = new MicroPythonRuntime()
    const out: Buffer[] = []
    await rt.init((c) => out.push(c))
    await rt.feed('print(6 * 7)\r')
    await new Promise((r) => setTimeout(r, 50))
    expect(Buffer.concat(out).toString('utf8')).toContain('42')
    rt.dispose()
  }, 30000)

  it('installs a simulated machine module (the WASM port ships none) (#267)', async () => {
    const rt = new MicroPythonRuntime()
    const out: Buffer[] = []
    await rt.init((c) => out.push(c))
    // `from machine import Pin` — the first line of most lessons — must work now.
    await rt.feed('from machine import Pin\rp = Pin(25, Pin.OUT)\rp.on()\rprint("pinval", p.value())\r')
    await new Promise((r) => setTimeout(r, 80))
    const text = Buffer.concat(out).toString('utf8')
    expect(text).toContain('pinval 1')
    expect(text).not.toContain('ImportError')
    rt.dispose()
  }, 30000)

  it('breaks a running loop via interrupt (worker reboot) and recovers (#135)', async () => {
    const rt = new MicroPythonRuntime()
    const out: Buffer[] = []
    await rt.init((c) => out.push(c))
    // Paste-run a perpetual loop (buddy_jr-style). Its feed never settles, and
    // it can't freeze us because it runs in the worker.
    const runP = rt.feed('\x05import time\r\nwhile True:\r\n    time.sleep_ms(20)\r\n\x04').catch(() => undefined)
    await new Promise((r) => setTimeout(r, 500))
    // Stop it — reboots the worker; the abandoned feed resolves.
    await rt.interrupt()
    await runP
    // The runtime works again afterwards.
    const result = await rt.runCaptured('print(6*7)')
    expect(result).toContain('42')
    rt.dispose()
  }, 30000)
})
