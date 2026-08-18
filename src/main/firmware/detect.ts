/**
 * Best-effort board/chip detection for firmware flashing (issue #14).
 *
 * Two independent strategies are combined:
 *
 *  - **Serial VID/PID** — ESP boards expose a USB-to-serial bridge whose USB
 *    vendor/product id often identifies the chip family. We enumerate serial
 *    ports (reusing the device layer's `listPorts`) and match against a small
 *    table of well-known bridge chips. This is heuristic: the same bridge chip
 *    (e.g. a CP2102) ships on both esp32 and esp8266 boards, so we default to
 *    the more common `esp32` and let the user override in the UI.
 *
 *  - **UF2 boot drive** — an RP2040 held in BOOTSEL mode mounts as a small FAT
 *    volume labelled `RPI-RP2`. We scan the platform's mount points for that
 *    label/marker and surface it as an `rp2040` candidate. The scanning itself
 *    lives in `fs/volumes.ts`, shared with the CIRCUITPY detection (#753) —
 *    the platforms differ, the boards don't.
 *
 * Detection never throws for the caller: failures in one strategy are swallowed
 * so the other can still contribute candidates.
 */
import { MicroPythonDevice } from '../device/MicroPythonDevice'
import { listVolumes, readVolumeFile, volumeHasFile, type Volume } from '../fs/volumes'
import type { BoardCandidate, BoardType } from './types'

/**
 * Known USB-serial bridge VID/PIDs found on common ESP dev boards. Values are
 * lowercase hex without the `0x` prefix, matching {@link PortInfo}. The mapped
 * board is the *most likely* family; the user can change it before flashing.
 */
const ESP_USB_BRIDGES: Array<{ vid: string; pid?: string; board: BoardType; chip: string }> = [
  // Silicon Labs CP210x — extremely common on ESP32 dev boards.
  { vid: '10c4', pid: 'ea60', board: 'esp32', chip: 'CP210x' },
  // WCH CH340 / CH341 — common on cheaper ESP8266 (NodeMCU) and some ESP32.
  { vid: '1a86', pid: '7523', board: 'esp8266', chip: 'CH340' },
  { vid: '1a86', pid: '5523', board: 'esp8266', chip: 'CH341' },
  // FTDI FT232 — older ESP dev boards.
  { vid: '0403', pid: '6001', board: 'esp32', chip: 'FT232R' },
  // Espressif native USB CDC (ESP32-S2/S3/C3 built-in USB JTAG/serial).
  { vid: '303a', board: 'esp32', chip: 'Espressif native USB' }
]

/** Match a serial port's VID/PID against the known ESP bridge table. */
function matchEspBridge(
  vendorId?: string,
  productId?: string
): { board: BoardType; chip: string } | undefined {
  if (!vendorId) return undefined
  const vid = vendorId.toLowerCase()
  const pid = productId?.toLowerCase()
  // Prefer an exact vid+pid match, then fall back to a vid-only entry.
  return (
    ESP_USB_BRIDGES.find((e) => e.vid === vid && e.pid && e.pid === pid) ??
    ESP_USB_BRIDGES.find((e) => e.vid === vid && !e.pid)
  )
}

/** Detect ESP candidates from the enumerated serial ports. */
async function detectEspFromSerial(): Promise<BoardCandidate[]> {
  const candidates: BoardCandidate[] = []
  try {
    const ports = await MicroPythonDevice.listPorts()
    for (const p of ports) {
      const match = matchEspBridge(p.vendorId, p.productId)
      if (!match) continue
      const detail = p.friendlyName ?? p.manufacturer ?? match.chip
      candidates.push({
        board: match.board,
        source: 'serial',
        port: p.path,
        label: `${p.path} — ${detail} (${match.board})`,
        vendorId: p.vendorId,
        productId: p.productId
      })
    }
  } catch {
    // Enumeration unavailable (e.g. no serialport binding) — yield nothing.
  }
  return candidates
}

/** A directory looks like an RP2040 boot drive if it carries the UF2 markers.
 *  The BOOTSEL FAT volume always contains INFO_UF2.TXT (and usually INDEX.HTM). */
const looksLikeRp2040Drive = (dir: string): Promise<boolean> =>
  volumeHasFile(dir, ['INFO_UF2.TXT', 'INDEX.HTM'])

/** Detect an RP2040 in BOOTSEL mode among `volumes` by its UF2 marker.
 *  Exported (over the volume list rather than the live filesystem) so the
 *  scanning rule is testable against a fixture directory. */
export async function detectRp2040Drive(volumes: Volume[]): Promise<BoardCandidate[]> {
  const candidates: BoardCandidate[] = []
  for (const vol of volumes) {
    // A label match is a strong signal; otherwise probe the contents (which is
    // the only option on Windows, where a volume is a bare drive letter).
    const labelled = vol.name.toUpperCase().includes('RPI-RP2')
    if (labelled || (vol.probeContents && (await looksLikeRp2040Drive(vol.mountPath)))) {
      candidates.push({
        board: 'rp2040',
        source: 'uf2-drive',
        mountPath: vol.mountPath,
        label: `${vol.mountPath} — RP2040 (RPI-RP2)`
      })
    }
  }
  return candidates
}

/**
 * Determine the micro:bit generation from its `DETAILS.TXT` "Board ID" — the
 * 4-digit code DAPLink writes (9900/9901 = v1 nRF51, 9903–9906 = v2 nRF52833).
 * Pure + exported for unit testing. Returns undefined when undeterminable.
 */
export function microbitVersionFromDetails(text: string): 'v1' | 'v2' | undefined {
  const m = text.match(/board id:\s*(\d{4})/i)
  if (!m) return undefined
  const id = Number(m[1])
  if (id === 9900 || id === 9901) return 'v1'
  if (id >= 9903 && id <= 9910) return 'v2'
  return undefined
}

/**
 * Whether a micro:bit's DETAILS.TXT reports DAPLink **bootloader/maintenance**
 * mode (the `MAINTENANCE` drive) rather than normal interface mode — MicroPython
 * can't be flashed in that mode. Pure + exported for unit testing.
 */
export function microbitMaintenanceFromDetails(text: string): boolean {
  const m = text.match(/daplink mode:\s*(.+)/i)
  if (!m) return false
  const mode = m[1].toLowerCase()
  return mode.includes('bootloader') || mode.includes('maintenance')
}

/** A directory looks like a BBC micro:bit DAPLink drive if it carries its markers.
 *  The MICROBIT / MAINTENANCE MSD volume always contains DETAILS.TXT. */
const looksLikeMicrobitDrive = (dir: string): Promise<boolean> =>
  volumeHasFile(dir, ['DETAILS.TXT', 'MICROBIT.HTM'])

/** Read the micro:bit generation + mode from a drive's DETAILS.TXT, if present. */
async function readMicrobitDetails(
  mount: string
): Promise<{ version?: 'v1' | 'v2'; maintenance: boolean }> {
  const text = await readVolumeFile(mount, 'DETAILS.TXT')
  if (text === null) return { maintenance: false }
  return {
    version: microbitVersionFromDetails(text),
    maintenance: microbitMaintenanceFromDetails(text)
  }
}

/** Build one micro:bit candidate for a mount, reading its generation + mode. */
async function microbitCandidate(mount: string, nameIsMaintenance: boolean): Promise<BoardCandidate> {
  const { version, maintenance: modeMaintenance } = await readMicrobitDetails(mount)
  // The volume label (MAINTENANCE) is the strongest signal; DETAILS.TXT's
  // "DAPLink Mode" backs it up (and covers Windows, where the path is a letter).
  const maintenance = nameIsMaintenance || modeMaintenance
  const gen = version ? ` ${version}` : ''
  const tag = maintenance ? 'MAINTENANCE — reconnect to flash' : 'MICROBIT'
  return {
    board: 'microbit',
    source: 'uf2-drive',
    mountPath: mount,
    label: `${mount} — BBC micro:bit${gen} (${tag})`,
    microbitVersion: version,
    maintenance
  }
}

/** Detect a BBC micro:bit among `volumes` by its MICROBIT/MAINTENANCE volume.
 *  Exported for the same reason as {@link detectRp2040Drive}. */
export async function detectMicrobitDrive(volumes: Volume[]): Promise<BoardCandidate[]> {
  const candidates: BoardCandidate[] = []
  for (const vol of volumes) {
    const upper = vol.name.toUpperCase()
    const labelled = upper.includes('MICROBIT') || upper.includes('MAINTENANCE')
    if (labelled || (vol.probeContents && (await looksLikeMicrobitDrive(vol.mountPath)))) {
      // On Windows the label isn't in the path, so maintenance mode is read from
      // DETAILS.TXT instead — `microbitCandidate` handles both.
      candidates.push(await microbitCandidate(vol.mountPath, upper.includes('MAINTENANCE')))
    }
  }
  return candidates
}

/**
 * Detect all board candidates, combining serial-port and UF2-drive strategies.
 * De-duplicates by (board, port/mountPath) and returns serial candidates first.
 * Always resolves (never rejects) — an empty array simply means nothing was
 * confidently recognised, which the UI presents as "choose manually".
 */
export async function detectBoards(): Promise<BoardCandidate[]> {
  // One volume scan feeds both drive strategies — they look at the same mounts
  // for different markers.
  const volumes = await listVolumes()
  const [esp, rp, microbit] = await Promise.all([
    detectEspFromSerial(),
    detectRp2040Drive(volumes),
    detectMicrobitDrive(volumes)
  ])
  const all = [...esp, ...rp, ...microbit]
  const seen = new Set<string>()
  return all.filter((c) => {
    const key = `${c.board}:${c.port ?? c.mountPath ?? ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
