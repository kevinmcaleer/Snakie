/**
 * Browser-native ESP32/ESP8266 firmware flashing (Web W3, issue #284).
 *
 * The desktop app shells out to the external `esptool` executable
 * (`src/main/firmware/flasher.ts`) — a browser tab can't spawn a process, so
 * this uses Espressif's official `esptool-js` port over the Web Serial API
 * instead. Requires a Chromium browser with Web Serial (`navigator.serial`);
 * callers should feature-detect with `hasWebSerial()` from `../platform`
 * before offering this flow, and it must be triggered from a user gesture
 * (a click), since `requestPort()` requires one.
 *
 * The esptool-js pieces (`Transport`/`ESPLoader`) are wrapped behind the
 * small {@link EspDriver} interface so the orchestration logic here — offset
 * parsing, progress mapping, error handling — is unit-testable without a real
 * serial port or the esptool-js runtime (mirrors how `flasher.ts`'s
 * `runStreaming` is tested via an injected `emit`).
 *
 * `FlashProgress`/`FlashResult` are the SAME shapes the desktop flasher emits
 * (re-exported, type-only, from the preload), so `FirmwareFlasher.tsx` can
 * render both with identical log/progress UI.
 */
import { ESPLoader, Transport } from 'esptool-js'
import type { IEspLoaderTerminal } from 'esptool-js'
import { hasWebSerial } from '../platform'
import type { FlashProgress, FlashResult } from '../../../../preload/index.d'

/** Minimal shape of esptool-js's `ESPLoader`, narrowed to what this module calls. */
export interface EspLoaderLike {
  main(): Promise<string>
  writeFlash(options: {
    fileArray: { data: Uint8Array; address: number }[]
    flashMode: string
    flashFreq: string
    flashSize: string
    eraseAll: boolean
    compress: boolean
    reportProgress?: (fileIndex: number, written: number, total: number) => void
  }): Promise<void>
  after(mode?: string): Promise<void>
}

/**
 * Everything the flash flow needs from esptool-js, injectable so tests can
 * substitute fakes. Generic over the transport type so `createLoader` gets
 * back exactly what `createTransport` produced (no unsafe casts needed).
 */
export interface EspDriver<TTransport = unknown> {
  createTransport(port: SerialPort): TTransport
  createLoader(transport: TTransport, terminal: IEspLoaderTerminal, baudrate: number): EspLoaderLike
  disconnectTransport(transport: TTransport): Promise<void>
}

/** The real esptool-js-backed driver, used in production. */
export const realEspDriver: EspDriver<Transport> = {
  createTransport: (port) => new Transport(port),
  createLoader: (transport, terminal, baudrate) =>
    new ESPLoader({ transport, terminal, baudrate }) as unknown as EspLoaderLike,
  disconnectTransport: (transport) => transport.disconnect()
}

/** Default esptool-js session baud rate — matches the desktop flasher's default. */
export const DEFAULT_ESP_BAUDRATE = 460800

/** Options for a browser ESP flash (parity with `FlashOptions` in the main-process types). */
export interface WebEspFlashOptions {
  /** Firmware bytes (`.bin`). */
  firmware: Uint8Array
  /** Flash offset as a hex string (e.g. `0x1000` for esp32, `0x0` for esp8266). */
  offset: string
  /** esptool-js session baud rate. Defaults to {@link DEFAULT_ESP_BAUDRATE}. */
  baudrate?: number
}

/** A sink for streamed progress lines — same shape the desktop flasher emits. */
export type Emit = (p: FlashProgress) => void

/**
 * Parse a flash offset hex string (e.g. `0x1000`) into a numeric address.
 * Falls back to `0` for an empty/unparseable value rather than throwing.
 */
export function parseOffset(offset: string | undefined): number {
  if (!offset) return 0
  const n = Number.parseInt(offset, 16)
  return Number.isFinite(n) ? n : 0
}

/**
 * Map an esptool-js `writeFlash` progress callback invocation to a
 * {@link FlashProgress} line.
 */
export function mapWriteProgress(written: number, total: number): FlashProgress {
  const percent = total > 0 ? Math.floor((written / total) * 100) : 0
  return { kind: 'log', message: `Flashing… ${percent}%`, percent }
}

/**
 * Request a serial port via the Web Serial API (must be called from a user
 * gesture). Throws a friendly error when Web Serial isn't available at all
 * (non-Chromium browser) rather than letting `navigator.serial` be
 * `undefined` throw a cryptic `TypeError`.
 */
export async function requestEspPort(filters?: SerialPortFilter[]): Promise<SerialPort> {
  if (!hasWebSerial()) {
    throw new Error(
      'Web Serial is not available in this browser. Use Google Chrome or Microsoft Edge to flash an ESP32/ESP8266.'
    )
  }
  return navigator.serial.requestPort(filters ? { filters } : undefined)
}

/**
 * Flash an ESP32/ESP8266 over an already-selected Web Serial port.
 * Dispatches to esptool-js (via the injectable {@link EspDriver}), streaming
 * connect/flash/reset progress through `emit`, and always emits a terminal
 * `done` event — mirroring `flash()` in `src/main/firmware/flasher.ts` so the
 * renderer's log/progress UI works identically for both paths.
 */
export async function flashEspInBrowser<TTransport>(
  port: SerialPort,
  opts: WebEspFlashOptions,
  emit: Emit,
  driver: EspDriver<TTransport> = realEspDriver as unknown as EspDriver<TTransport>
): Promise<FlashResult> {
  const terminal: IEspLoaderTerminal = {
    clean: () => {},
    write: (data: string) => emit({ kind: 'log', message: data }),
    writeLine: (data: string) => emit({ kind: 'log', message: data })
  }

  let result: FlashResult
  let transport: TTransport | undefined
  try {
    transport = driver.createTransport(port)
    const loader = driver.createLoader(transport, terminal, opts.baudrate ?? DEFAULT_ESP_BAUDRATE)

    const chip = await loader.main()
    emit({ kind: 'log', message: `Connected to: ${chip}` })

    await loader.writeFlash({
      fileArray: [{ data: opts.firmware, address: parseOffset(opts.offset) }],
      flashMode: 'keep',
      flashFreq: 'keep',
      flashSize: 'keep',
      eraseAll: false,
      compress: true,
      reportProgress: (_fileIndex, written, total) => emit(mapWriteProgress(written, total))
    })
    emit({ kind: 'log', message: 'Flash complete.' })

    await loader.after('hard_reset')
    result = { ok: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    emit({ kind: 'error', message })
    result = { ok: false, error: message }
  } finally {
    if (transport) {
      await driver.disconnectTransport(transport).catch(() => {
        // Best-effort: the port may already be closed (e.g. the board reset
        // and briefly disappeared), which isn't worth surfacing as an error.
      })
    }
  }

  emit({
    kind: 'done',
    ok: result.ok,
    message: result.ok ? 'Done.' : (result.error ?? 'Flashing failed.')
  })
  return result
}
