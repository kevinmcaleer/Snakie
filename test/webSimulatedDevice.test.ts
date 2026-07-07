import { describe, it, expect, vi } from 'vitest'
import { WebSimulatedDevice } from '../src/shared/device/webSimulatedDevice'
import type { WebReplRuntime } from '../src/shared/device/webMicroPythonRuntime'
import { isTelemetry } from '../src/renderer/src/components/instrument-telemetry'

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder('utf-8')

/**
 * A lightweight {@link WebReplRuntime} fake so these tests stay fast and
 * deterministic (no WebAssembly load) — the browser analogue of
 * `FakeRuntime` in `test/simulatedDevice.test.ts`, but `Uint8Array`-based.
 */
class FakeWebRuntime implements WebReplRuntime {
  feeds: string[] = []
  capturedCalls: string[] = []
  /** Canned response returned by the next runCaptured call. */
  nextCaptured = ''
  disposed = false
  private emit: ((chunk: Uint8Array) => void) | null = null
  async init(onOutput: (chunk: Uint8Array) => void): Promise<void> {
    this.emit = onOutput
    onOutput(textEncoder.encode('MicroPython (fake)\r\n>>> '))
  }
  async feed(data: string): Promise<void> {
    this.feeds.push(data)
    this.emit?.(textEncoder.encode(`echo:${data}`))
  }
  async runCaptured(code: string): Promise<string> {
    this.capturedCalls.push(code)
    return this.nextCaptured
  }
  dispose(): void {
    this.disposed = true
  }
}

describe('WebSimulatedDevice lifecycle', () => {
  it('starts disconnected and reports the virtual path', () => {
    const dev = new WebSimulatedDevice(new FakeWebRuntime())
    const status = dev.getStatus()
    expect(status.state).toBe('disconnected')
    expect(status.path).toBe('sim://web')
    expect(dev.isConnected()).toBe(false)
  })

  it('connects, boots the runtime, and streams status transitions', async () => {
    const runtime = new FakeWebRuntime()
    const dev = new WebSimulatedDevice(runtime)
    const statuses: string[] = []
    dev.on('status', (s) => statuses.push(s.state))

    await dev.connect()

    expect(dev.isConnected()).toBe(true)
    expect(statuses).toEqual(['connecting', 'connected'])
  })

  it('streams parseable SNK telemetry while connected', async () => {
    vi.useFakeTimers()
    try {
      const dev = new WebSimulatedDevice(new FakeWebRuntime())
      const chunks: Uint8Array[] = []
      dev.on('data', (c) => chunks.push(c))
      await dev.connect()

      await vi.advanceTimersByTimeAsync(500)

      const text = chunks.map((c) => textDecoder.decode(c)).join('')
      const lines = text.split('\r\n').filter(Boolean)
      const telemetryLines = lines.filter(isTelemetry)
      expect(telemetryLines.length).toBeGreaterThan(0)

      await dev.disconnect()
    } finally {
      vi.useRealTimers()
    }
  })

  it('stops telemetry and tears down the runtime on disconnect/dispose', async () => {
    const runtime = new FakeWebRuntime()
    const dev = new WebSimulatedDevice(runtime)
    await dev.connect()
    await dev.dispose()
    expect(runtime.disposed).toBe(true)
    expect(dev.isConnected()).toBe(false)
  })
})

describe('WebSimulatedDevice exec/eval', () => {
  it('answers the <<SNKV>> live-pin probe without touching the runtime', async () => {
    const runtime = new FakeWebRuntime()
    const dev = new WebSimulatedDevice(runtime)
    await dev.connect()
    const { stdout } = await dev.exec('print("<<SNKV>>0:")')
    expect(stdout).toContain('<<SNKV>>0:')
    expect(runtime.capturedCalls.length).toBe(0)
  })

  it('answers a mip install snippet with a clear offline sentinel', async () => {
    const runtime = new FakeWebRuntime()
    const dev = new WebSimulatedDevice(runtime)
    await dev.connect()
    const { stdout } = await dev.exec('print("<<SNAKIE_MIP_START>>")')
    expect(stdout).toContain('<<SNAKIE_MIP_START>>')
    expect(stdout).toContain('<<SNAKIE_MIP_ERR>>')
    expect(stdout).toMatch(/offline/i)
  })

  it('runs arbitrary code on the (fake) real interpreter', async () => {
    const runtime = new FakeWebRuntime()
    runtime.nextCaptured = '42\n'
    const dev = new WebSimulatedDevice(runtime)
    await dev.connect()
    const { stdout } = await dev.exec('print(6*7)')
    expect(stdout).toBe('42\n')
    expect(runtime.capturedCalls).toContain('print(6*7)')
  })

  it('rejects exec/eval when not connected', async () => {
    const dev = new WebSimulatedDevice(new FakeWebRuntime())
    await expect(dev.exec('1')).rejects.toThrow('Not connected')
  })

  it('sendData/interrupt/softReset feed the runtime', async () => {
    const runtime = new FakeWebRuntime()
    const dev = new WebSimulatedDevice(runtime)
    await dev.connect()
    await dev.sendData('print(1)\r')
    await dev.interrupt()
    await dev.softReset()
    expect(runtime.feeds).toEqual(['print(1)\r', '\x03', '\x04'])
  })
})

describe('WebSimulatedDevice filesystem (VFS snippets)', () => {
  it('listDir parses the JSON directory listing', async () => {
    const runtime = new FakeWebRuntime()
    runtime.nextCaptured = '[["main.py", false, 12], ["lib", true, 0]]\n'
    const dev = new WebSimulatedDevice(runtime)
    await dev.connect()
    const entries = await dev.listDir('/')
    expect(entries).toEqual([
      { name: 'main.py', isDir: false, size: 12 },
      { name: 'lib', isDir: true, size: 0 }
    ])
  })

  it('hides Emscripten system mounts at the root', async () => {
    const runtime = new FakeWebRuntime()
    runtime.nextCaptured = '[["dev", true, 0], ["lib", true, 0]]\n'
    const dev = new WebSimulatedDevice(runtime)
    await dev.connect()
    const entries = await dev.listDir('/')
    expect(entries.map((e) => e.name)).toEqual(['lib'])
  })

  it('writeFile hex-encodes the payload for the VFS snippet', async () => {
    const runtime = new FakeWebRuntime()
    const dev = new WebSimulatedDevice(runtime)
    await dev.connect()
    await dev.writeFile('/main.py', 'print(1)')
    const snippet = runtime.capturedCalls[runtime.capturedCalls.length - 1]
    // 'print(1)' → 7072696e74283129 in hex.
    expect(snippet).toContain('7072696e74283129')
  })

  it('stat parses the JSON [isDir, size, mtime] tuple', async () => {
    const runtime = new FakeWebRuntime()
    runtime.nextCaptured = '[false, 8, 1700000000]\n'
    const dev = new WebSimulatedDevice(runtime)
    await dev.connect()
    const st = await dev.stat('/main.py')
    expect(st).toEqual({ isDir: false, size: 8, mtime: 1700000000 })
  })
})
