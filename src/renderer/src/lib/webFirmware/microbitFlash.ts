/**
 * Browser-native BBC micro:bit firmware flashing (Web W3, issue #284).
 *
 * The desktop app copies a `.hex` file onto the mounted `MICROBIT` drive
 * (`src/main/firmware/flasher.ts`) — the SAME drive-copy mechanism it uses
 * for RP2040. A browser tab can't see or auto-mount that drive directly, but
 * a micro:bit's on-board DAPLink interface chip also speaks CMSIS-DAP over
 * WebUSB, so this flashes it directly via ARM's `dapjs`, following the same
 * approach MakeCode uses for its "Connect device" flash flow. Requires a
 * Chromium browser with WebUSB (`navigator.usb`); callers should
 * feature-detect with `hasWebUSB()` from `../platform` before offering this
 * flow, and it must be triggered from a user gesture (a click), since
 * `requestDevice()` requires one. `driveCopyFlash.ts` provides a guided
 * fallback for browsers/boards where WebUSB DAPLink isn't available or
 * doesn't respond (older micro:bit v1 DAPLink firmware in particular).
 *
 * dapjs's `WebUSB`/`DAPLink` are wrapped behind the small {@link
 * MicrobitDriver} interface so the orchestration logic here — progress
 * mapping, connect/flash/disconnect sequencing, error handling — is
 * unit-testable without a real USB device (mirrors how `espFlash.ts` wraps
 * esptool-js).
 *
 * `FlashProgress`/`FlashResult` are the SAME shapes the desktop flasher
 * emits (re-exported, type-only, from the preload), so `FirmwareFlasher.tsx`
 * can render both with identical log/progress UI.
 */
import { DAPLink, WebUSB } from 'dapjs'
import { hasWebUSB } from '../platform'
import type { FlashProgress, FlashResult } from '../../../../preload/index.d'

/** ARM Mbed/DAPLink USB vendor id — the micro:bit's on-board interface chip. */
export const MICROBIT_USB_VENDOR_ID = 0x0d28

/** Minimal shape of dapjs's `DAPLink` target, narrowed to what this module calls. */
export interface MicrobitTargetLike {
  connect(): Promise<void>
  disconnect(): Promise<void>
  flash(buffer: BufferSource, pageSize?: number): Promise<void>
}

/**
 * Everything the flash flow needs from dapjs, injectable so tests can
 * substitute fakes. Generic over the transport type so `createTarget` gets
 * back exactly what `createTransport` produced (no unsafe casts needed).
 */
export interface MicrobitDriver<TTransport = unknown> {
  createTransport(device: USBDevice): TTransport
  /**
   * Builds the DAPLink target, wiring `onProgress` to its progress event
   * (`DAPLink.EVENT_PROGRESS`, a 0–1 fraction) — kept out of the shared
   * orchestration function below so it doesn't need to know dapjs's actual
   * event-name constant.
   */
  createTarget(transport: TTransport, onProgress: (fraction: number) => void): MicrobitTargetLike
}

/** The real dapjs-backed driver, used in production. */
export const realMicrobitDriver: MicrobitDriver<WebUSB> = {
  createTransport: (device) => new WebUSB(device),
  createTarget: (transport, onProgress) => {
    const target = new DAPLink(transport)
    target.on(DAPLink.EVENT_PROGRESS, onProgress)
    return target
  }
}

/** A sink for streamed progress lines — same shape the desktop flasher emits. */
export type Emit = (p: FlashProgress) => void

/**
 * Map a dapjs `EVENT_PROGRESS` payload (a 0–1 fraction) to a
 * {@link FlashProgress} line.
 */
export function mapDapProgress(fraction: number): FlashProgress {
  const percent = Math.max(0, Math.min(100, Math.round(fraction * 100)))
  return { kind: 'log', message: `Flashing… ${percent}%`, percent }
}

/**
 * Request a micro:bit's DAPLink USB device via WebUSB (must be called from a
 * user gesture). Throws a friendly error when WebUSB isn't available at all
 * (non-Chromium browser) rather than letting `navigator.usb` be `undefined`
 * throw a cryptic `TypeError`.
 */
export async function requestMicrobitDevice(): Promise<USBDevice> {
  if (!hasWebUSB()) {
    throw new Error(
      'WebUSB is not available in this browser. Use Google Chrome or Microsoft Edge, or use ' +
        '"Copy to drive" instead.'
    )
  }
  return navigator.usb.requestDevice({ filters: [{ vendorId: MICROBIT_USB_VENDOR_ID }] })
}

/**
 * Flash a BBC micro:bit over an already-selected WebUSB device. Dispatches
 * to dapjs (via the injectable {@link MicrobitDriver}), streaming
 * connect/flash progress through `emit`, and always emits a terminal `done`
 * event — mirroring `flashEspInBrowser` in `espFlash.ts` so the renderer's
 * log/progress UI works identically for every board.
 */
export async function flashMicrobitInBrowser<TTransport>(
  device: USBDevice,
  // Constrained to a real `ArrayBuffer` (never `SharedArrayBuffer`) so it
  // satisfies dapjs's `BufferSource`-typed `flash()` — matches what
  // `new Uint8Array(await file.arrayBuffer())` actually produces.
  firmware: Uint8Array<ArrayBuffer>,
  emit: Emit,
  driver: MicrobitDriver<TTransport> = realMicrobitDriver as unknown as MicrobitDriver<TTransport>
): Promise<FlashResult> {
  let result: FlashResult
  let target: MicrobitTargetLike | undefined
  try {
    const transport = driver.createTransport(device)
    target = driver.createTarget(transport, (fraction) => emit(mapDapProgress(fraction)))

    emit({ kind: 'log', message: 'Connecting to micro:bit…' })
    await target.connect()

    emit({ kind: 'log', message: 'Flashing…' })
    await target.flash(firmware)
    emit({ kind: 'log', message: 'Flash complete.' })

    result = { ok: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    emit({ kind: 'error', message })
    result = { ok: false, error: message }
  } finally {
    if (target) {
      await target.disconnect().catch(() => {
        // Best-effort: the device may already be gone (e.g. it reset after
        // flashing), which isn't worth surfacing as an error.
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
