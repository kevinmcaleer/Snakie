import { describe, it, expect } from 'vitest'
import { MicroPythonRuntime } from '../src/main/device/MicroPythonRuntime'

/**
 * #612 — a program Run must show ONLY its output in the REPL, never the source or
 * paste-mode `===` framing. This runs a program through `runStream` on the REAL
 * MicroPython interpreter (the one the simulator uses) and asserts the streamed
 * output is exactly the program's own output — no echoed source, no framing.
 */
describe('runStream — streaming program output (#612)', () => {
  it('streams only the program output, never the source or === framing', async () => {
    const rt = new MicroPythonRuntime()
    let out = ''
    await rt.init((chunk) => (out += chunk.toString('utf8')))

    await rt.runStream('print("hello from run")\nfor i in range(3):\n    print("n", i)')
    rt.dispose()

    // The program's own stdout streamed through…
    expect(out).toContain('hello from run')
    expect(out).toContain('n 0')
    expect(out).toContain('n 2')
    // …and NONE of the #612 pollution: no echoed source, no paste `===`, no
    // raw-REPL framing.
    expect(out).not.toContain('print(') // source never echoed
    expect(out).not.toContain('===')
    expect(out).not.toContain('raw REPL')
    expect(out).not.toMatch(/^OK/m)
    // …and it ends at a fresh `>>>` prompt so the REPL reads as ready for input.
    expect(out.trimEnd().endsWith('>>>')).toBe(true)
  }, 30000)

  it('streams a traceback (stderr) without echoing the source', async () => {
    const rt = new MicroPythonRuntime()
    let out = ''
    await rt.init((chunk) => (out += chunk.toString('utf8')))

    await rt.runStream('print("before")\nraise ValueError("boom")')
    rt.dispose()

    expect(out).toContain('before')
    expect(out).toContain('ValueError') // the traceback streamed
    expect(out).not.toContain('raise ValueError') // but not the source line
    expect(out).not.toContain('===')
  }, 30000)
})
