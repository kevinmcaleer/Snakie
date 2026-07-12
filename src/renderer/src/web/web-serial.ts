/**
 * WEB Serial device backend — epic #267, Phase W2 (#465).
 * =============================================================================
 *
 * Talks to a REAL MicroPython board (Pico / ESP / …) plugged into USB, from the
 * browser, over the Web Serial API. It pairs a {@link WebSerialTransport} (the
 * bytes) with the shared {@link RawReplClient} (the raw-REPL protocol) to present
 * the SAME `window.api.device` surface as the sim, so the editor, Run, the device
 * file tree and instruments all work against hardware with no code fork.
 *
 * Web Serial needs a Chromium browser and a user gesture to pick a port
 * (`requestPort`); already-granted ports come back from `getPorts()`. The
 * {@link ./web-device-router} multiplexes this with the sim backend.
 */
import { RawReplClient, type SerialTransport } from '../../../shared/raw-repl'
import { SERIAL_USB_FILTERS, describeUsb } from '../../../shared/serial-filters'

/** Structural Web Serial types (not in every TS DOM lib). */
interface WebSerialPort {
  open(opts: { baudRate: number }): Promise<void>
  close(): Promise<void>
  readable: ReadableStream<Uint8Array> | null
  writable: WritableStream<Uint8Array> | null
  getInfo(): { usbVendorId?: number; usbProductId?: number }
  setSignals?(s: { dataTerminalReady?: boolean; requestToSend?: boolean }): Promise<void>
}
interface WebSerial {
  requestPort(opts?: { filters?: { usbVendorId?: number; usbProductId?: number }[] }): Promise<WebSerialPort>
  getPorts(): Promise<WebSerialPort[]>
}

const navSerial = (): WebSerial | null =>
  (navigator as unknown as { serial?: WebSerial }).serial ?? null

/** True when this browser can talk to USB serial devices (Chromium). */
export const webSerialSupported = (): boolean => navSerial() !== null

/** The Web Serial byte transport backing a {@link RawReplClient}. */
export class WebSerialTransport implements SerialTransport {
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  private dataCb: ((c: Uint8Array) => void) | null = null
  private closed = false

  constructor(private readonly port: WebSerialPort) {}

  async open(baudRate = 115200): Promise<void> {
    await this.port.open({ baudRate })
    void this.readLoop()
  }
  private async readLoop(): Promise<void> {
    while (this.port.readable && !this.closed) {
      const reader = this.port.readable.getReader()
      this.reader = reader
      try {
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          if (value && value.length) this.dataCb?.(value)
        }
      } catch {
        /* stream broke (unplug) — fall through; close() flips `closed` */
      } finally {
        reader.releaseLock()
      }
    }
  }
  onData(cb: (c: Uint8Array) => void): void {
    this.dataCb = cb
  }
  async write(data: Uint8Array): Promise<void> {
    if (!this.port.writable) throw new Error('Serial port is not writable')
    const writer = this.port.writable.getWriter()
    try {
      await writer.write(data)
    } finally {
      writer.releaseLock()
    }
  }
  async setSignals(s: { dataTerminalReady?: boolean; requestToSend?: boolean }): Promise<void> {
    await this.port.setSignals?.(s)
  }
  async close(): Promise<void> {
    this.closed = true
    try {
      await this.reader?.cancel()
    } catch {
      /* ignore */
    }
    try {
      await this.port.close()
    } catch {
      /* ignore */
    }
  }
}

interface DeviceStatus {
  state: 'disconnected' | 'connecting' | 'connected'
  path: string
  baudRate: number
}

/** Path scheme for Web Serial ports in the port dropdown. */
export const WEBSERIAL_PREFIX = 'webserial://'
export const WEBSERIAL_PICK = 'webserial://pick'

/**
 * Build the Web Serial device backend. Returns the `window.api.device` method
 * surface (a subset — the {@link ./web-device-router} routes to it when a real
 * board is the active connection).
 */
export function createWebSerialBackend(): Record<string, unknown> {
  const dataSubs = new Set<(chunk: Uint8Array) => void>()
  const statusSubs = new Set<(s: DeviceStatus) => void>()
  let state: DeviceStatus['state'] = 'disconnected'
  let path = ''
  let transport: WebSerialTransport | null = null
  let client: RawReplClient | null = null
  // Synthetic path → granted port, so the dropdown can re-select one.
  const known = new Map<string, WebSerialPort>()

  const emitData = (chunk: Uint8Array): void => dataSubs.forEach((cb) => cb(chunk))
  const setState = (s: DeviceStatus['state'], p = path): void => {
    state = s
    path = p
    const st: DeviceStatus = { state, path, baudRate: 115200 }
    statusSubs.forEach((cb) => cb(st))
  }
  const need = (): RawReplClient => {
    if (!client) throw new Error('No board connected')
    return client
  }

  const openPort = async (port: WebSerialPort, p: string): Promise<void> => {
    setState('connecting', p)
    transport = new WebSerialTransport(port)
    await transport.open(115200)
    client = new RawReplClient(transport, emitData)
    setState('connected', p)
    // Nudge the board to a fresh friendly prompt so the shell shows `>>>`.
    await client.sendData('\r\x03').catch(() => undefined)
  }

  return {
    listPorts: async (): Promise<{ path: string; friendlyName: string }[]> => {
      const serial = navSerial()
      if (!serial) return []
      known.clear()
      const ports = await serial.getPorts()
      return ports.map((port, i) => {
        const p = `${WEBSERIAL_PREFIX}${i}`
        known.set(p, port)
        const { usbVendorId, usbProductId } = port.getInfo()
        return { path: p, friendlyName: describeUsb(usbVendorId, usbProductId) }
      })
    },

    connect: async (p: string): Promise<void> => {
      const serial = navSerial()
      if (!serial) throw new Error('Web Serial needs a Chromium-based browser')
      let port: WebSerialPort | undefined
      if (p === WEBSERIAL_PICK) {
        // MUST run inside the user gesture (the Connect click) — do it first.
        port = await serial.requestPort({ filters: SERIAL_USB_FILTERS })
        const idx = known.size
        p = `${WEBSERIAL_PREFIX}${idx}`
        known.set(p, port)
      } else {
        port = known.get(p) ?? (await serial.getPorts())[Number(p.slice(WEBSERIAL_PREFIX.length))]
      }
      if (!port) throw new Error('That serial port is no longer available')
      await openPort(port, p)
    },

    disconnect: async (): Promise<void> => {
      await transport?.close()
      transport = null
      client = null
      if (state !== 'disconnected') setState('disconnected', '')
    },

    getStatus: async (): Promise<DeviceStatus> => ({ state, path, baudRate: 115200 }),

    exec: async (code: string) => need().exec(code),
    eval: async (code: string) => need().eval(code),
    sendData: async (data: string) => need().sendData(data),
    sendControl: async (target: string, payload?: string) => need().sendControl(target, payload ?? ''),
    interrupt: async () => need().interrupt(),
    softReset: async () => need().softReset(),

    listDir: async (p = '/') => need().listDir(p),
    df: async () => null,
    readFile: async (p: string) => need().readFile(p),
    readFileBytes: async (p: string) => need().readFileBytes(p),
    writeFile: async (p: string, contents: string) => need().writeFile(p, contents),
    remove: async (p: string) => need().remove(p),
    mkdir: async (p: string) => need().mkdir(p),
    rename: async (from: string, to: string) => need().rename(from, to),
    stat: async (p: string) => need().stat(p),

    onData: (cb: (chunk: Uint8Array) => void) => {
      dataSubs.add(cb)
      return () => dataSubs.delete(cb)
    },
    onStatus: (cb: (s: DeviceStatus) => void) => {
      statusSubs.add(cb)
      return () => statusSubs.delete(cb)
    }
  }
}
