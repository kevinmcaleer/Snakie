/**
 * WEB device router — multiplex the simulator + real Web Serial boards (#465).
 * =============================================================================
 *
 * `window.api.device` on the web is a single namespace, but there are now two
 * backends: the offline WASM {@link ./web-device simulator} and a real board over
 * {@link ./web-serial Web Serial}. This router presents both in the port dropdown
 * (the virtual "Simulated device", any granted USB boards, and a "Connect a USB
 * board…" entry that triggers the picker), routes `connect()` to the right one,
 * and forwards every other call + `onData`/`onStatus` event to whichever backend
 * is active. Real-board features (device file tree, module installs, instruments)
 * work over the serial transport exactly as they do on the sim.
 */
import { VIRTUAL_PORT_PATH } from '../../../shared/virtual-device'
import { createWebDeviceApi } from './web-device'
import { createWebSerialBackend, webSerialSupported, WEBSERIAL_PICK, WEBSERIAL_PREFIX } from './web-serial'

type Backend = Record<string, unknown>
type Fn = (...a: unknown[]) => unknown
const call = (b: Backend, m: string, ...a: unknown[]): unknown => (b[m] as Fn)(...a)

interface Port {
  path: string
  friendlyName: string
}

export function createWebDeviceRouter(): Record<string, unknown> {
  const sim = createWebDeviceApi()
  const serial = createWebSerialBackend()
  // Which backend owns the current connection. Defaults to sim (status/no-ops).
  let active: Backend = sim

  const isSerialPath = (p: string): boolean => p === WEBSERIAL_PICK || p.startsWith(WEBSERIAL_PREFIX)

  return {
    listPorts: async (): Promise<Port[]> => {
      const simPorts = (await call(sim, 'listPorts')) as Port[]
      const serialPorts = webSerialSupported() ? ((await call(serial, 'listPorts')) as Port[]) : []
      const pick: Port[] = webSerialSupported()
        ? [{ path: WEBSERIAL_PICK, friendlyName: '＋ Connect a USB board…' }]
        : []
      return [...simPorts, ...serialPorts, ...pick]
    },

    connect: async (path: string): Promise<void> => {
      const next = isSerialPath(path) ? serial : sim
      // Drop any existing connection on the OTHER backend first.
      if (active !== next) await (call(active, 'disconnect') as Promise<unknown>).catch(() => undefined)
      active = next
      await call(next, 'connect', path)
    },

    disconnect: async (): Promise<void> => {
      await call(active, 'disconnect')
    },

    getStatus: async () => call(active, 'getStatus'),

    // ── Everything else delegates to the active backend ──────────────────────
    exec: async (code: string) => call(active, 'exec', code),
    eval: async (code: string) => call(active, 'eval', code),
    sendData: async (data: string) => call(active, 'sendData', data),
    runProgram: async (code: string) => call(active, 'runProgram', code),
    sendControl: async (target: string, payload?: string) => call(active, 'sendControl', target, payload),
    interrupt: async () => call(active, 'interrupt'),
    softReset: async () => call(active, 'softReset'),
    listDir: async (p = '/') => call(active, 'listDir', p),
    df: async () => call(active, 'df'),
    readFile: async (p: string) => call(active, 'readFile', p),
    readFileBytes: async (p: string) => call(active, 'readFileBytes', p),
    writeFile: async (p: string, contents: string) => call(active, 'writeFile', p, contents),
    remove: async (p: string) => call(active, 'remove', p),
    mkdir: async (p: string) => call(active, 'mkdir', p),
    rename: async (from: string, to: string) => call(active, 'rename', from, to),
    stat: async (p: string) => call(active, 'stat', p),

    // Subscribe to BOTH backends so events flow regardless of which is active.
    onData: (cb: (chunk: Uint8Array) => void) => {
      const a = call(sim, 'onData', cb) as () => void
      const b = call(serial, 'onData', cb) as () => void
      return () => {
        a()
        b()
      }
    },
    onStatus: (cb: (s: unknown) => void) => {
      const a = call(sim, 'onStatus', cb) as () => void
      const b = call(serial, 'onStatus', cb) as () => void
      return () => {
        a()
        b()
      }
    }
  }
}

/** The sim's virtual port path, re-exported so callers don't reach past here. */
export { VIRTUAL_PORT_PATH }
