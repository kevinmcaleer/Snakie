import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ESP_BAUDRATE,
  flashEspInBrowser,
  mapWriteProgress,
  parseOffset,
  requestEspPort,
  type EspDriver,
  type EspLoaderLike
} from '../src/renderer/src/lib/webFirmware/espFlash'
import type { FlashProgress } from '../src/main/firmware/types'

/**
 * Unit tests for the browser ESP32/ESP8266 flash flow (Web W3, issue #284).
 * `esptool-js`'s `Transport`/`ESPLoader` are stubbed behind a fake `EspDriver`
 * so this exercises the orchestration (offset parsing, progress mapping,
 * connect/flash/reset sequencing, error handling) without a real serial port.
 */

describe('parseOffset', () => {
  it('parses a hex offset string', () => {
    expect(parseOffset('0x1000')).toBe(0x1000)
    expect(parseOffset('0x0')).toBe(0)
  })

  it('falls back to 0 for empty/unparseable input', () => {
    expect(parseOffset(undefined)).toBe(0)
    expect(parseOffset('')).toBe(0)
    expect(parseOffset('not-hex')).toBe(0)
  })
})

describe('mapWriteProgress', () => {
  it('computes a percentage from written/total', () => {
    expect(mapWriteProgress(50, 200)).toEqual<FlashProgress>({
      kind: 'log',
      message: 'Flashing… 25%',
      percent: 25
    })
  })

  it('treats a zero total as 0%', () => {
    expect(mapWriteProgress(0, 0)).toEqual<FlashProgress>({
      kind: 'log',
      message: 'Flashing… 0%',
      percent: 0
    })
  })
})

describe('requestEspPort', () => {
  it('throws a friendly error when Web Serial is unavailable', async () => {
    // The vitest environment is plain Node — no `navigator.serial`.
    await expect(requestEspPort()).rejects.toThrow(/Web Serial is not available/)
  })
})

/** A fake transport handle — just needs identity for the fake driver to track. */
interface FakeTransport {
  disconnected: boolean
}

function makeFakeDriver(overrides?: {
  main?: () => Promise<string>
  writeFlash?: EspLoaderLike['writeFlash']
  after?: EspLoaderLike['after']
}): { driver: EspDriver<FakeTransport>; transport: FakeTransport } {
  const transport: FakeTransport = { disconnected: false }
  const loader: EspLoaderLike = {
    main: overrides?.main ?? (async () => 'ESP32'),
    writeFlash:
      overrides?.writeFlash ??
      (async (options) => {
        options.reportProgress?.(0, 50, 100)
        options.reportProgress?.(0, 100, 100)
      }),
    after: overrides?.after ?? (async () => {})
  }
  const driver: EspDriver<FakeTransport> = {
    createTransport: () => transport,
    createLoader: () => loader,
    disconnectTransport: async (t) => {
      t.disconnected = true
    }
  }
  return { driver, transport }
}

describe('flashEspInBrowser', () => {
  const fakePort = {} as SerialPort

  it('connects, flashes, resets, and reports success', async () => {
    const { driver, transport } = makeFakeDriver()
    const events: FlashProgress[] = []

    const result = await flashEspInBrowser(
      fakePort,
      { firmware: new Uint8Array([1, 2, 3]), offset: '0x1000' },
      (p) => events.push(p),
      driver
    )

    expect(result).toEqual({ ok: true })
    expect(transport.disconnected).toBe(true)
    expect(events.some((e) => e.message === 'Connected to: ESP32')).toBe(true)
    expect(events.some((e) => e.percent === 50)).toBe(true)
    expect(events.some((e) => e.percent === 100)).toBe(true)
    expect(events.at(-1)).toEqual({ kind: 'done', ok: true, message: 'Done.' })
  })

  it('uses the default baud rate when none is given', async () => {
    let seenBaud: number | undefined
    const transport: FakeTransport = { disconnected: false }
    const driver: EspDriver<FakeTransport> = {
      createTransport: () => transport,
      createLoader: (_t, _terminal, baudrate) => {
        seenBaud = baudrate
        return { main: async () => 'ESP32', writeFlash: async () => {}, after: async () => {} }
      },
      disconnectTransport: async () => {}
    }

    await flashEspInBrowser(fakePort, { firmware: new Uint8Array(), offset: '0x0' }, () => {}, driver)

    expect(seenBaud).toBe(DEFAULT_ESP_BAUDRATE)
  })

  it('reports failure and still disconnects when the chip never connects', async () => {
    const { driver, transport } = makeFakeDriver({
      main: async () => {
        throw new Error('No serial device selected.')
      }
    })
    const events: FlashProgress[] = []

    const result = await flashEspInBrowser(
      fakePort,
      { firmware: new Uint8Array([1]), offset: '0x1000' },
      (p) => events.push(p),
      driver
    )

    expect(result).toEqual({ ok: false, error: 'No serial device selected.' })
    expect(transport.disconnected).toBe(true)
    expect(events.at(-1)).toEqual({
      kind: 'done',
      ok: false,
      message: 'No serial device selected.'
    })
  })

  it('reports failure when writeFlash rejects', async () => {
    const { driver } = makeFakeDriver({
      writeFlash: async () => {
        throw new Error('Timed out waiting for packet header')
      }
    })

    const result = await flashEspInBrowser(
      fakePort,
      { firmware: new Uint8Array([1]), offset: '0x1000' },
      () => {},
      driver
    )

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/Timed out/)
  })

  it('does not throw when disconnecting a lost port fails', async () => {
    const driver: EspDriver<FakeTransport> = {
      createTransport: () => ({ disconnected: false }),
      createLoader: () => ({
        main: async () => 'ESP32',
        writeFlash: async () => {},
        after: async () => {}
      }),
      disconnectTransport: async () => {
        throw new Error('port already closed')
      }
    }

    const result = await flashEspInBrowser(
      fakePort,
      { firmware: new Uint8Array([1]), offset: '0x1000' },
      () => {},
      driver
    )

    expect(result).toEqual({ ok: true })
  })
})
