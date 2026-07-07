import { describe, it, expect } from 'vitest'
import { WebSerialDevice } from '../src/web/webSerialDevice'
import { CTRL_A, CTRL_B, CTRL_C, CTRL_D } from '../src/shared/raw-repl'

const encoder = new TextEncoder()

/**
 * A fake `SerialPort` that plays a MicroPython board: replies to the raw-REPL
 * handshake and to `exec`'d code via a caller-supplied `script`. Adapted from
 * `test/webSerialTransport.test.ts`'s `FakeSerialPort`, with board reply logic
 * layered on top matching `test/rawReplEngine.test.ts`'s `FakeBoard` — proving
 * `WebSerialDevice` drives the exact same `RawReplEngine` protocol end-to-end
 * over a (fake) Web Serial connection.
 */
class FakeMicroPythonPort {
  opened = false
  closed = false
  signalCalls: Array<{ dataTerminalReady?: boolean; requestToSend?: boolean }> = []
  /** Every raw string written to the port, in order (for asserting on the wire format). */
  writeLog: string[] = []
  private disconnectListeners: Array<() => void> = []
  private pendingChunks: Uint8Array[] = []
  private pendingReadResolvers: Array<(v: { value?: Uint8Array; done: boolean }) => void> = []
  private acc = ''
  private streamDone = false

  constructor(private readonly script: (code: string) => { stdout: string; stderr: string }) {}

  readable = {
    getReader: () => ({
      read: (): Promise<{ value?: Uint8Array; done: boolean }> => {
        if (this.streamDone) return Promise.resolve({ done: true })
        if (this.pendingChunks.length > 0) {
          return Promise.resolve({ value: this.pendingChunks.shift(), done: false })
        }
        return new Promise((resolve) => this.pendingReadResolvers.push(resolve))
      },
      cancel: (): Promise<void> => {
        while (this.pendingReadResolvers.length > 0) {
          this.pendingReadResolvers.shift()?.({ done: true })
        }
        return Promise.resolve()
      },
      releaseLock: (): void => undefined
    })
  } as unknown as ReadableStream<Uint8Array>

  writable = {
    getWriter: () => ({
      write: (chunk: Uint8Array): Promise<void> => {
        const str = new TextDecoder().decode(chunk)
        this.writeLog.push(str)
        this.handleWrite(str)
        return Promise.resolve()
      },
      close: (): Promise<void> => Promise.resolve(),
      releaseLock: (): void => undefined
    })
  } as unknown as WritableStream<Uint8Array>

  async open(): Promise<void> {
    this.opened = true
  }

  async close(): Promise<void> {
    this.closed = true
  }

  async setSignals(signals: { dataTerminalReady?: boolean; requestToSend?: boolean }): Promise<void> {
    this.signalCalls.push(signals)
  }

  getSignals(): Promise<never> {
    throw new Error('not implemented in fake')
  }

  getInfo(): { usbVendorId?: number; usbProductId?: number } {
    return { usbVendorId: 0x2e8a, usbProductId: 0x0005 }
  }

  addEventListener(type: string, listener: () => void): void {
    if (type === 'disconnect') this.disconnectListeners.push(listener)
  }

  removeEventListener(type: string, listener: () => void): void {
    if (type === 'disconnect') {
      this.disconnectListeners = this.disconnectListeners.filter((l) => l !== listener)
    }
  }

  unplug(): void {
    this.streamDone = true
    for (const l of [...this.disconnectListeners]) l()
  }

  private handleWrite(str: string): void {
    this.acc += str
    if (this.acc.endsWith(CTRL_C + CTRL_C + CTRL_A)) {
      this.acc = ''
      this.reply('raw REPL; CTRL-B to exit\r\n>')
      return
    }
    if (str === CTRL_B) {
      this.acc = ''
      return
    }
    if (str === CTRL_D) {
      const code = this.acc.slice(0, -1)
      this.acc = ''
      const { stdout, stderr } = this.script(code)
      this.reply(`OK${stdout}${CTRL_D}${stderr}${CTRL_D}>`)
      return
    }
  }

  private reply(text: string): void {
    const chunk = encoder.encode(text)
    if (this.pendingReadResolvers.length > 0) {
      this.pendingReadResolvers.shift()?.({ value: chunk, done: false })
    } else {
      this.pendingChunks.push(chunk)
    }
  }
}

async function connectedDevice(
  script: (code: string) => { stdout: string; stderr: string } = () => ({ stdout: '', stderr: '' })
): Promise<{ device: WebSerialDevice; port: FakeMicroPythonPort }> {
  const port = new FakeMicroPythonPort(script)
  const device = new WebSerialDevice(port as unknown as SerialPort)
  await device.connect()
  return { device, port }
}

describe('WebSerialDevice (#283 Web Serial device parity)', () => {
  it('connects, reaching the "connected" status', async () => {
    const { device, port } = await connectedDevice()
    expect(port.opened).toBe(true)
    expect(device.isConnected()).toBe(true)
    expect(device.getStatus()).toEqual({ state: 'connected', baudRate: 115200 })
  })

  it('exec() drives the raw-REPL handshake over the fake port and returns stdout', async () => {
    const { device } = await connectedDevice((code) => ({ stdout: `ran:${code}`, stderr: '' }))
    const result = await device.exec('1+1')
    expect(result.stdout).toBe('ran:1+1')
    expect(result.stderr).toBe('')
  })

  it('eval() throws when the board reports a traceback on stderr', async () => {
    const { device } = await connectedDevice(() => ({ stdout: '', stderr: 'Traceback: boom' }))
    await expect(device.eval('1/0')).rejects.toThrow('Traceback: boom')
  })

  it('listDir/readFile/writeFile work over the fake transport with zero extra protocol code', async () => {
    const { device } = await connectedDevice((code) => {
      if (code.includes('_ls(')) return { stdout: '[["main.py", false, 42]]', stderr: '' }
      return { stdout: '', stderr: '' }
    })
    const entries = await device.listDir('/')
    expect(entries).toEqual([{ name: 'main.py', isDir: false, size: 42 }])
  })

  it('forwards non-exec data to "data" listeners but suppresses exec traffic', async () => {
    const { device } = await connectedDevice((code) => ({ stdout: `out:${code}`, stderr: '' }))
    const seen: string[] = []
    device.on('data', (chunk) => seen.push(new TextDecoder().decode(chunk)))

    // Exec traffic (handshake/banner/OK/markers) must NOT reach the listener —
    // the fake board only ever "replies", never echoes user keystrokes, so an
    // empty capture here proves nothing reached the console during exec.
    await device.exec('print(1)')
    expect(seen.join('')).toBe('')
  })

  it('disconnect() closes the transport and resets state to "disconnected"', async () => {
    const { device, port } = await connectedDevice()
    const statuses: string[] = []
    device.on('status', (s) => statuses.push(s.state))
    await device.disconnect()
    expect(port.closed).toBe(true)
    expect(device.isConnected()).toBe(false)
    expect(statuses).toContain('disconnected')
  })

  it('an unplug event transitions status to "disconnected" with an error message', async () => {
    const { device, port } = await connectedDevice()
    const statuses: Array<{ state: string; error?: string }> = []
    device.on('status', (s) => statuses.push({ state: s.state, error: s.error }))
    port.unplug()
    await new Promise((r) => setTimeout(r, 0))
    expect(device.isConnected()).toBe(false)
    expect(statuses.some((s) => s.state === 'disconnected' && s.error === 'Device unplugged')).toBe(true)
  })

  it('resetViaSignals() toggles DTR/RTS via the port', async () => {
    const { device, port } = await connectedDevice()
    await device.resetViaSignals()
    expect(port.signalCalls).toEqual([
      { dataTerminalReady: false, requestToSend: false },
      { dataTerminalReady: true, requestToSend: true }
    ])
  })

  it('sendControl() writes a sanitised SNKCMD line verbatim (no raw-REPL handshake)', async () => {
    const { device, port } = await connectedDevice()
    await device.sendControl('led', 'on')
    expect(port.writeLog).toEqual(['SNKCMD led on\n'])
  })

  it('interrupt()/softReset() write the expected control bytes', async () => {
    const { device, port } = await connectedDevice()
    await device.interrupt()
    await device.softReset()
    expect(port.writeLog).toEqual([CTRL_C, CTRL_D])
  })
})
