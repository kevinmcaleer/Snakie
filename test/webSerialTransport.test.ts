import { describe, it, expect, vi } from 'vitest'
import { WebSerialTransport } from '../src/web/webSerialTransport'

/**
 * A minimal fake `SerialPort` (issue #283): implements exactly the surface
 * `WebSerialTransport` touches (open/close/setSignals/getInfo/readable/
 * writable/addEventListener/removeEventListener), without any real DOM or
 * hardware — enough to drive the transport end-to-end in a plain Node test
 * environment. Modeled after `test/rawReplEngine.test.ts`'s `FakeBoard`.
 */
class FakeSerialPort {
  opened = false
  closed = false
  writes: Uint8Array[] = []
  signalCalls: Array<{ dataTerminalReady?: boolean; requestToSend?: boolean }> = []
  private disconnectListeners: Array<() => void> = []
  /** Queue of chunks waiting to be delivered to the next `reader.read()`. */
  private pendingChunks: Uint8Array[] = []
  private pendingReadResolvers: Array<(v: { value?: Uint8Array; done: boolean }) => void> = []
  private streamDone = false
  private readCancelled = false

  readable = {
    getReader: () => ({
      read: (): Promise<{ value?: Uint8Array; done: boolean }> => {
        if (this.readCancelled || this.streamDone) return Promise.resolve({ done: true })
        if (this.pendingChunks.length > 0) {
          return Promise.resolve({ value: this.pendingChunks.shift(), done: false })
        }
        return new Promise((resolve) => this.pendingReadResolvers.push(resolve))
      },
      cancel: (): Promise<void> => {
        this.readCancelled = true
        // Wake up any pending read so the loop can exit.
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
        this.writes.push(chunk)
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

  /** Test helper: push a chunk in as if the board sent it. */
  emit(chunk: Uint8Array): void {
    if (this.pendingReadResolvers.length > 0) {
      this.pendingReadResolvers.shift()?.({ value: chunk, done: false })
    } else {
      this.pendingChunks.push(chunk)
    }
  }

  /** Test helper: simulate the browser's native unplug event. */
  unplug(): void {
    this.streamDone = true
    for (const l of [...this.disconnectListeners]) l()
  }
}

const encoder = new TextEncoder()

describe('WebSerialTransport (#283 Web Serial transport)', () => {
  it('opens at the given baud rate and starts pumping reads into onData', async () => {
    const port = new FakeSerialPort()
    const received: Uint8Array[] = []
    const transport = new WebSerialTransport(
      port as unknown as SerialPort,
      (chunk) => received.push(chunk),
      () => undefined
    )
    await transport.open({ baudRate: 115200 })
    expect(port.opened).toBe(true)

    port.emit(encoder.encode('hello'))
    // Let the read-loop microtask resolve.
    await new Promise((r) => setTimeout(r, 0))
    expect(received).toHaveLength(1)
    expect(new TextDecoder().decode(received[0])).toBe('hello')
  })

  it('defaults to 115200 baud when no options are given', async () => {
    const port = new FakeSerialPort()
    const openSpy = vi.spyOn(port, 'open')
    const transport = new WebSerialTransport(port as unknown as SerialPort, () => undefined, () => undefined)
    await transport.open()
    expect(openSpy).toHaveBeenCalledWith({ baudRate: 115200 })
  })

  it('write() sends bytes through the writer', async () => {
    const port = new FakeSerialPort()
    const transport = new WebSerialTransport(port as unknown as SerialPort, () => undefined, () => undefined)
    await transport.open()
    await transport.write('abc')
    await transport.write(new Uint8Array([1, 2, 3]))
    expect(port.writes).toHaveLength(2)
    expect(new TextDecoder().decode(port.writes[0])).toBe('abc')
    expect(Array.from(port.writes[1])).toEqual([1, 2, 3])
  })

  it('write() rejects before open()', async () => {
    const port = new FakeSerialPort()
    const transport = new WebSerialTransport(port as unknown as SerialPort, () => undefined, () => undefined)
    await expect(transport.write('x')).rejects.toThrow('Not connected')
  })

  it('resetViaSignals() toggles DTR/RTS off then on', async () => {
    const port = new FakeSerialPort()
    const transport = new WebSerialTransport(port as unknown as SerialPort, () => undefined, () => undefined)
    await transport.open()
    await transport.resetViaSignals()
    expect(port.signalCalls).toEqual([
      { dataTerminalReady: false, requestToSend: false },
      { dataTerminalReady: true, requestToSend: true }
    ])
  })

  it('reports "unplugged" when the browser fires its native disconnect event', async () => {
    const port = new FakeSerialPort()
    const reasons: string[] = []
    const transport = new WebSerialTransport(
      port as unknown as SerialPort,
      () => undefined,
      (reason) => reasons.push(reason)
    )
    await transport.open()
    port.unplug()
    await new Promise((r) => setTimeout(r, 0))
    expect(reasons).toEqual(['unplugged'])
  })

  it('reports "unplugged" when the read loop errors (some platforms skip the event)', async () => {
    const port = new FakeSerialPort()
    const reasons: string[] = []
    const transport = new WebSerialTransport(
      port as unknown as SerialPort,
      () => undefined,
      (reason) => reasons.push(reason)
    )
    await transport.open()
    // Simulate a mid-read error without the native event firing.
    port.readable.getReader = () => ({
      read: () => Promise.reject(new Error('device disappeared')),
      cancel: () => Promise.resolve(),
      releaseLock: () => undefined
    })
    // Re-open to restart the read loop against the erroring reader.
    await transport.close()
    const transport2 = new WebSerialTransport(
      port as unknown as SerialPort,
      () => undefined,
      (reason) => reasons.push(reason)
    )
    await transport2.open()
    await new Promise((r) => setTimeout(r, 0))
    expect(reasons).toContain('unplugged')
  })

  it('close() is idempotent, releases the writer, and does not report a disconnect', async () => {
    const port = new FakeSerialPort()
    const reasons: string[] = []
    const transport = new WebSerialTransport(
      port as unknown as SerialPort,
      () => undefined,
      (reason) => reasons.push(reason)
    )
    await transport.open()
    await transport.close()
    await transport.close() // idempotent — must not throw
    expect(port.closed).toBe(true)
    expect(reasons).toEqual([])
  })
})
