import { describe, it, expect } from 'vitest'
import { MicroPythonRuntime } from '../src/main/device/MicroPythonRuntime'

/**
 * Integration test for the REAL MicroPython WebAssembly runtime (issue #135) —
 * this actually loads + runs the interpreter, so it proves the offline device
 * executes Python (this is what makes "hello world" print). Generous timeouts
 * cover the one-off WASM load.
 */
describe('MicroPythonRuntime (real WebAssembly)', () => {
  it('runs a hello-world program via paste mode and streams its output', async () => {
    const rt = new MicroPythonRuntime()
    const out: Buffer[] = []
    await rt.init((c) => out.push(c))

    // Exactly what the Run button sends: Ctrl-E (paste mode) … Ctrl-D (execute).
    const program = 'print("Hello, World!")\nfor i in range(3):\n    print("n", i)\n'
    await rt.feed('\x05' + program + '\x04')
    await new Promise((r) => setTimeout(r, 50)) // let the flush timer drain

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
})
