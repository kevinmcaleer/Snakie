import { createRequire } from 'module'
import { describe, it, expect } from 'vitest'
import { WebMicroPythonRuntime } from '../src/shared/device/webMicroPythonRuntime'
import { loadMicroPython } from '@micropython/micropython-webassembly-pyscript/micropython.mjs'

// The wasm binary is resolved with Node's `require` here — fine, since this
// test file is never shipped to the browser. In the real Web Worker entry the
// same `wasmUrl` slot is filled by a Vite `?url` import instead.
const require = createRequire(import.meta.url)
const wasmUrl = require.resolve('@micropython/micropython-webassembly-pyscript/micropython.wasm')

/**
 * Integration test for the REAL MicroPython WebAssembly runtime running
 * through the BROWSER-oriented (`Uint8Array`, no Node deps) wrapper (epic
 * #267 Phase W1) — proves the same interpreter behaviour as
 * `MicroPythonRuntime` survives the port to `Uint8Array`/injected loader.
 */
describe('WebMicroPythonRuntime (real WebAssembly)', () => {
  it('runs a hello-world program via paste mode and streams its output', async () => {
    const rt = new WebMicroPythonRuntime(wasmUrl, loadMicroPython)
    const out: Uint8Array[] = []
    await rt.init((c) => out.push(c))

    // Exactly what the Run button sends: Ctrl-E (paste mode) … Ctrl-D (execute).
    const program = 'print("Hello, World!")\nfor i in range(3):\n    print("n", i)\n'
    await rt.feed('\x05' + program + '\x04')
    await new Promise((r) => setTimeout(r, 50)) // let the flush timer drain

    const text = concatText(out)
    expect(text).toContain('Hello, World!')
    expect(text).toContain('n 2')
    rt.dispose()
  }, 30000)

  it('evaluates expressions interactively', async () => {
    const rt = new WebMicroPythonRuntime(wasmUrl, loadMicroPython)
    const out: Uint8Array[] = []
    await rt.init((c) => out.push(c))
    await rt.feed('print(6 * 7)\r')
    await new Promise((r) => setTimeout(r, 50))
    expect(concatText(out)).toContain('42')
    rt.dispose()
  }, 30000)

  it('runCaptured runs a snippet out-of-band and returns its stdout', async () => {
    const rt = new WebMicroPythonRuntime(wasmUrl, loadMicroPython)
    const out: Uint8Array[] = []
    await rt.init((c) => out.push(c))
    const result = await rt.runCaptured('import sys\nsys.stdout.write("captured")')
    expect(result).toBe('captured')
    // The captured snippet's output must NOT reach the console sink.
    expect(concatText(out)).not.toContain('captured')
    rt.dispose()
  }, 30000)
})

function concatText(chunks: Uint8Array[]): string {
  const total = chunks.reduce((n, c) => n + c.length, 0)
  const merged = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    merged.set(c, offset)
    offset += c.length
  }
  return new TextDecoder('utf-8').decode(merged)
}
