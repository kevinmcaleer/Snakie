import { describe, it, expect } from 'vitest'
import { MicroPythonRuntime } from '../src/main/device/MicroPythonRuntime'

/**
 * A running program's output must STREAM to the terminal, not arrive when the
 * program ends (#1179). `time.sleep` in the WASM port is a busy-wait inside
 * `runPython`, so nothing that waits for the worker's event loop — a flush timer
 * — fires until the program returns. A `while True:` never returns, which is
 * how the web simulator's Run came to "do nothing": every `print` was stuck in
 * the worker until Stop.
 *
 * Against the real interpreter: a program prints, sleeps for a while, and prints
 * again. The first line has to reach us well before the program is over.
 */
describe('simulator program output streams while the program runs', () => {
  it('delivers a printed line before a following sleep finishes', async () => {
    const rt = new MicroPythonRuntime()
    const dec = new TextDecoder()
    let seen = ''
    let firstHelloAt = 0
    await rt.init((buf) => {
      seen += dec.decode(buf)
      if (!firstHelloAt && seen.includes('hello')) firstHelloAt = Date.now()
    })

    const started = Date.now()
    await rt.runStream(['import time', "print('hello')", 'time.sleep(1.5)', "print('bye')"].join('\n'))
    const finishedAt = Date.now()

    expect(seen).toContain('hello')
    expect(seen).toContain('bye')
    expect(firstHelloAt).toBeGreaterThan(0)
    // 'hello' came out at the top of the program, not with 'bye' at the end.
    expect(finishedAt - firstHelloAt).toBeGreaterThan(1000)
    expect(firstHelloAt - started).toBeLessThan(1000)
    rt.dispose()
  }, 30000)
})
