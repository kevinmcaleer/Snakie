import { describe, it, expect, afterEach } from 'vitest'
import {
  describePort,
  getGrantedPorts,
  getSerialFilters,
  requestSnakiePort
} from '../src/web/portPicker'
import { USB_SERIAL_BRIDGES } from '../src/shared/usb-bridges'

/** Minimal fake of the `Serial` (`navigator.serial`) surface used by `portPicker.ts`. */
function installFakeNavigatorSerial(overrides: {
  getPorts?: () => Promise<unknown[]>
  requestPort?: (opts?: { filters?: unknown[] }) => Promise<unknown>
}): void {
  ;(globalThis as { navigator?: unknown }).navigator = {
    serial: {
      getPorts: overrides.getPorts ?? (async () => []),
      requestPort: overrides.requestPort ?? (async () => ({}))
    }
  }
}

afterEach(() => {
  delete (globalThis as { navigator?: unknown }).navigator
})

describe('getSerialFilters (#283 port picker)', () => {
  it('builds one SerialPortFilter per shared bridge-table entry, hex-decoded to numbers', () => {
    const filters = getSerialFilters()
    expect(filters).toHaveLength(USB_SERIAL_BRIDGES.length)
    // Spot-check the Pico native-USB entry (vid 2e8a, pid 0005).
    const pico = filters.find((f) => f.usbVendorId === 0x2e8a && f.usbProductId === 0x0005)
    expect(pico).toBeDefined()
    // A vid-only entry (Espressif native USB, 303a) has no usbProductId.
    const espNative = filters.find((f) => f.usbVendorId === 0x303a)
    expect(espNative).toBeDefined()
    expect(espNative?.usbProductId).toBeUndefined()
  })
})

describe('requestSnakiePort (#283 port picker)', () => {
  it('calls navigator.serial.requestPort with the shared VID/PID filters', async () => {
    let capturedFilters: unknown[] | undefined
    installFakeNavigatorSerial({
      requestPort: async (opts) => {
        capturedFilters = opts?.filters
        return { fake: 'port' }
      }
    })
    const port = await requestSnakiePort()
    expect(port).toEqual({ fake: 'port' })
    expect(capturedFilters).toHaveLength(USB_SERIAL_BRIDGES.length)
  })

  it('throws a clear error when Web Serial is unsupported', async () => {
    delete (globalThis as { navigator?: unknown }).navigator
    ;(globalThis as { navigator?: unknown }).navigator = {}
    await expect(requestSnakiePort()).rejects.toThrow('Web Serial is not supported')
  })
})

describe('getGrantedPorts (#283 port picker, classroom fast-path)', () => {
  it('returns already-granted ports with zero prompt', async () => {
    installFakeNavigatorSerial({ getPorts: async () => [{ id: 1 }, { id: 2 }] })
    const ports = await getGrantedPorts()
    expect(ports).toEqual([{ id: 1 }, { id: 2 }])
  })

  it('returns an empty list when Web Serial is unsupported, rather than throwing', async () => {
    ;(globalThis as { navigator?: unknown }).navigator = {}
    await expect(getGrantedPorts()).resolves.toEqual([])
  })
})

describe('describePort (#283 port picker)', () => {
  it('labels a known device using the shared bridge table', () => {
    const fakePort = { getInfo: () => ({ usbVendorId: 0x2e8a, usbProductId: 0x0005 }) }
    const description = describePort(fakePort as unknown as SerialPort)
    expect(description.recognized).toBe(true)
    expect(description.label).toMatch(/Raspberry Pi Pico/)
    expect(description.vendorId).toBe('2e8a')
    expect(description.productId).toBe('0005')
  })

  it('falls back to "Unknown serial device" for an unrecognized VID/PID', () => {
    const fakePort = { getInfo: () => ({ usbVendorId: 0xffff, usbProductId: 0xffff }) }
    const description = describePort(fakePort as unknown as SerialPort)
    expect(description.recognized).toBe(false)
    expect(description.label).toBe('Unknown serial device')
  })

  it('handles a port with no VID/PID info at all (e.g. Bluetooth)', () => {
    const fakePort = { getInfo: () => ({}) }
    const description = describePort(fakePort as unknown as SerialPort)
    expect(description.recognized).toBe(false)
    expect(description.vendorId).toBeUndefined()
    expect(description.productId).toBeUndefined()
  })
})
