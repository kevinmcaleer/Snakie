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
 *    label/marker and surface it as an `rp2040` candidate.
 *
 * Detection never throws for the caller: failures in one strategy are swallowed
 * so the other can still contribute candidates.
 */
import { promises as fs } from 'fs'
import { homedir, platform } from 'os'
import { join } from 'path'
import { MicroPythonDevice } from '../device/MicroPythonDevice'
import { matchUsbBridge } from '../../shared/usb-bridges'
import type { BoardCandidate, BoardType } from './types'

/**
 * Match a serial port's VID/PID against the shared USB bridge table (#283),
 * restricted to the ESP families this flashing-detection path cares about —
 * `rp2040` (BOOTSEL-mode Picos) is detected separately via the UF2 boot
 * drive below, never via its native-USB serial VID/PID here, so a Pico
 * running MicroPython isn't mis-surfaced as a flashing candidate.
 */
function matchEspBridge(
  vendorId?: string,
  productId?: string
): { board: BoardType; chip: string } | undefined {
  const match = matchUsbBridge(vendorId, productId)
  if (!match || (match.board !== 'esp32' && match.board !== 'esp8266')) return undefined
  return match
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

/**
 * Candidate mount-point roots to scan for a UF2 boot drive, per platform. We
 * only read directory listings (cheap, read-only) so this is safe to call
 * repeatedly.
 */
function uf2SearchRoots(): string[] {
  const os = platform()
  if (os === 'win32') {
    // Windows mounts removable drives as letters; scan A–Z roots.
    return Array.from({ length: 26 }, (_, i) => `${String.fromCharCode(65 + i)}:\\`)
  }
  if (os === 'darwin') return ['/Volumes']
  // Linux: media is typically auto-mounted under one of these.
  return ['/media', join('/media', process.env.USER ?? ''), '/run/media', join(homedir())]
}

/** A directory looks like an RP2040 boot drive if it carries the UF2 markers. */
async function looksLikeRp2040Drive(dir: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(dir)
    const lower = entries.map((e) => e.toLowerCase())
    // The BOOTSEL FAT volume always contains INFO_UF2.TXT (and usually INDEX.HTM).
    return lower.includes('info_uf2.txt') || lower.includes('index.htm')
  } catch {
    return false
  }
}

/** Detect an RP2040 in BOOTSEL mode by scanning mount points for the UF2 marker. */
async function detectRp2040Drive(): Promise<BoardCandidate[]> {
  const candidates: BoardCandidate[] = []
  const os = platform()

  for (const root of uf2SearchRoots()) {
    if (!root) continue
    if (os === 'win32') {
      // Each drive letter is itself a potential boot volume.
      if (await looksLikeRp2040Drive(root)) {
        candidates.push({
          board: 'rp2040',
          source: 'uf2-drive',
          mountPath: root,
          label: `${root} — RP2040 (RPI-RP2)`
        })
      }
      continue
    }
    // POSIX: the root contains per-volume subdirectories; inspect each one.
    let names: string[]
    try {
      names = await fs.readdir(root)
    } catch {
      continue
    }
    for (const name of names) {
      const mount = join(root, name)
      // A direct label match is a strong signal; otherwise probe the contents.
      const labelled = name.toUpperCase().includes('RPI-RP2')
      if (labelled || (await looksLikeRp2040Drive(mount))) {
        candidates.push({
          board: 'rp2040',
          source: 'uf2-drive',
          mountPath: mount,
          label: `${mount} — RP2040 (RPI-RP2)`
        })
      }
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

/** A directory looks like a BBC micro:bit DAPLink drive if it carries its markers. */
async function looksLikeMicrobitDrive(dir: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(dir)
    const lower = entries.map((e) => e.toLowerCase())
    // The MICROBIT / MAINTENANCE MSD volume always contains DETAILS.TXT.
    return lower.includes('details.txt') || lower.includes('microbit.htm')
  } catch {
    return false
  }
}

/** Read the micro:bit generation + mode from a drive's DETAILS.TXT, if present.
 *  Resolves the filename case-insensitively (it can mount as `details.txt` on a
 *  case-sensitive vfat mount). */
async function readMicrobitDetails(
  mount: string
): Promise<{ version?: 'v1' | 'v2'; maintenance: boolean }> {
  try {
    const entries = await fs.readdir(mount)
    const file = entries.find((e) => e.toLowerCase() === 'details.txt')
    if (!file) return { maintenance: false }
    const text = await fs.readFile(join(mount, file), 'utf8')
    return {
      version: microbitVersionFromDetails(text),
      maintenance: microbitMaintenanceFromDetails(text)
    }
  } catch {
    return { maintenance: false }
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

/** Detect a BBC micro:bit by scanning mount points for the MICROBIT/MAINTENANCE volume. */
async function detectMicrobitDrive(): Promise<BoardCandidate[]> {
  const candidates: BoardCandidate[] = []
  const os = platform()

  for (const root of uf2SearchRoots()) {
    if (!root) continue
    if (os === 'win32') {
      // No volume label in the path on Windows; rely on the DETAILS.TXT marker
      // (the mode is then read from the file itself).
      if (await looksLikeMicrobitDrive(root)) candidates.push(await microbitCandidate(root, false))
      continue
    }
    let names: string[]
    try {
      names = await fs.readdir(root)
    } catch {
      continue
    }
    for (const name of names) {
      const mount = join(root, name)
      const upper = name.toUpperCase()
      const labelled = upper.includes('MICROBIT') || upper.includes('MAINTENANCE')
      if (labelled || (await looksLikeMicrobitDrive(mount))) {
        candidates.push(await microbitCandidate(mount, upper.includes('MAINTENANCE')))
      }
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
  const [esp, rp, microbit] = await Promise.all([
    detectEspFromSerial(),
    detectRp2040Drive(),
    detectMicrobitDrive()
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
