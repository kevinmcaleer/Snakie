import { describe, expect, it, vi, afterEach } from 'vitest'
import {
  MICROBIT_USB_VENDOR_ID,
  flashMicrobitInBrowser,
  mapDapProgress,
  requestMicrobitDevice,
  type MicrobitDriver,
  type MicrobitTargetLike
} from '../src/renderer/src/lib/webFirmware/microbitFlash'
import type { FlashProgress } from '../src/main/firmware/types'

/**
 * Unit tests for the browser BBC micro:bit flash flow (Web W3, issue #284).
 * dapjs's `WebUSB`/`DAPLink` are stubbed behind a fake `MicrobitDriver` so
 * this exercises the orchestration (progress mapping, connect/flash/
 * disconnect sequencing, error handling) without a real WebUSB device.
 */

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('mapDapProgress', () => {
  it('converts a 0-1 fraction to a rounded percentage', () => {
    expect(mapDapProgress(0.5)).toEqual<FlashProgress>({
      kind: 'log',
      message: 'Flashing… 50%',
      percent: 50
    })
    expect(mapDapProgress(0)).toEqual<FlashProgress>({
      kind: 'log',
      message: 'Flashing… 0%',
      percent: 0
    })
    expect(mapDapProgress(1)).toEqual<FlashProgress>({
      kind: 'log',
      message: 'Flashing… 100%',
      percent: 100
    })
  })

  it('clamps out-of-range fractions', () => {
    expect(mapDapProgress(-0.2).percent).toBe(0)
    expect(mapDapProgress(1.5).percent).toBe(100)
  })
})

describe('requestMicrobitDevice', () => {
  it('throws a friendly error when WebUSB is unavailable', async () => {
    // The vitest environment is plain Node — no `navigator.usb`.
    await expect(requestMicrobitDevice()).rejects.toThrow(/WebUSB is not available/)
  })

  it('requests a device filtered to the DAPLink vendor id when WebUSB exists', async () => {
    const requestDevice = vi.fn(async () => ({}) as USBDevice)
    vi.stubGlobal('navigator', { userAgent: 'x', usb: { requestDevice } })

    await requestMicrobitDevice()

    expect(requestDevice).toHaveBeenCalledWith({ filters: [{ vendorId: MICROBIT_USB_VENDOR_ID }] })
  })
})

/** A fake transport handle — just needs identity for the fake driver to track. */
interface FakeTransport {
  closed: boolean
}

function makeFakeDriver(overrides?: {
  connect?: MicrobitTargetLike['connect']
  flash?: MicrobitTargetLike['flash']
}): { driver: MicrobitDriver<FakeTransport>; target: MicrobitTargetLike & { disconnected: boolean } } {
  const target = {
    disconnected: false,
    connect: overrides?.connect ?? (async () => {}),
    flash: overrides?.flash ?? (async () => {}),
    disconnect: async () => {
      target.disconnected = true
    }
  }
  const driver: MicrobitDriver<FakeTransport> = {
    createTransport: () => ({ closed: false }),
    createTarget: (_transport, onProgress) => {
      // Simulate dapjs emitting a couple of progress ticks during flash().
      const originalFlash = target.flash
      target.flash = async (buffer) => {
        onProgress(0.5)
        await originalFlash(buffer)
        onProgress(1)
      }
      return target
    }
  }
  return { driver, target }
}

describe('flashMicrobitInBrowser', () => {
  const fakeDevice = {} as USBDevice

  it('connects, flashes, disconnects, and reports success', async () => {
    const { driver, target } = makeFakeDriver()
    const events: FlashProgress[] = []

    const result = await flashMicrobitInBrowser(
      fakeDevice,
      new Uint8Array([1, 2, 3]),
      (p) => events.push(p),
      driver
    )

    expect(result).toEqual({ ok: true })
    expect(target.disconnected).toBe(true)
    expect(events.some((e) => e.percent === 50)).toBe(true)
    expect(events.some((e) => e.percent === 100)).toBe(true)
    expect(events.at(-1)).toEqual({ kind: 'done', ok: true, message: 'Done.' })
  })

  it('reports failure and still disconnects when connect() rejects', async () => {
    const { driver, target } = makeFakeDriver({
      connect: async () => {
        throw new Error('No device selected.')
      }
    })
    const events: FlashProgress[] = []

    const result = await flashMicrobitInBrowser(
      fakeDevice,
      new Uint8Array([1]),
      (p) => events.push(p),
      driver
    )

    expect(result).toEqual({ ok: false, error: 'No device selected.' })
    expect(target.disconnected).toBe(true)
    expect(events.at(-1)).toEqual({ kind: 'done', ok: false, message: 'No device selected.' })
  })

  it('reports failure when flash() rejects', async () => {
    const { driver } = makeFakeDriver({
      flash: async () => {
        throw new Error('Flash error')
      }
    })

    const result = await flashMicrobitInBrowser(fakeDevice, new Uint8Array([1]), () => {}, driver)

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/Flash error/)
  })

  it('does not throw when disconnecting a lost device fails', async () => {
    const target = {
      connect: async () => {},
      flash: async () => {},
      disconnect: async () => {
        throw new Error('device already gone')
      }
    }
    const driver: MicrobitDriver<FakeTransport> = {
      createTransport: () => ({ closed: false }),
      createTarget: () => target
    }

    const result = await flashMicrobitInBrowser(fakeDevice, new Uint8Array([1]), () => {}, driver)

    expect(result).toEqual({ ok: true })
  })
})
