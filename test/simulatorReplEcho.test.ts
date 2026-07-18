import { describe, it, expect } from 'vitest'
import { MicroPythonRuntime } from '../src/main/device/MicroPythonRuntime'
import { simulatedTelemetryFrame } from '../src/shared/simulation'
import { makeTelemetryFilter } from '../src/renderer/src/components/terminal-telemetry'

/**
 * Regression for the offline REPL "swallowed space" bug (#135): the simulated
 * device streams `SNK …` telemetry continuously, and the Terminal's telemetry
 * filter used to HOLD a lone echoed space — which then got concatenated onto the
 * next telemetry line and dropped, so typing a space in the REPL appeared to do
 * nothing. This drives the REAL interpreter through the REAL filter with
 * telemetry interleaved, exactly like the renderer, and asserts the echoed space
 * survives to the console.
 */
describe('simulated REPL echo survives interleaved telemetry', () => {
  it('does not swallow a typed space', async () => {
    const rt = new MicroPythonRuntime()
    const filter = makeTelemetryFilter()
    const decoder = new TextDecoder()
    let visible = ''
    const onChunk = (buf: Buffer): void => {
      visible += filter.push(decoder.decode(buf))
    }

    await rt.init(onChunk)

    // Type a line containing a space, char by char, with a telemetry frame
    // interleaved after each keystroke (as the running device emits ~every 120ms).
    let tick = 0
    for (const ch of 'print("a b")\r') {
      await rt.feed(ch)
      onChunk(Buffer.from(simulatedTelemetryFrame(tick++).join('\r\n') + '\r\n', 'utf8'))
    }
    await new Promise((r) => setTimeout(r, 50))

    // `a b")` only appears in the ECHO of the typed input (the program's stdout is
    // just `a b`), so finding it proves the echoed space wasn't dropped.
    expect(visible).toContain('a b")')
    // And no telemetry leaked into the console.
    expect(visible).not.toContain('SNK ')
    rt.dispose()
  }, 30000)
})
