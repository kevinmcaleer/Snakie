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
 * Detect all board candidates, combining serial-port and UF2-drive strategies.
 * De-duplicates by (board, port/mountPath) and returns serial candidates first.
 * Always resolves (never rejects) — an empty array simply means nothing was
 * confidently recognised, which the UI presents as "choose manually".
 */
export async function detectBoards(): Promise<BoardCandidate[]> {
  const [esp, rp] = await Promise.all([detectEspFromSerial(), detectRp2040Drive()])
  const all = [...esp, ...rp]
  const seen = new Set<string>()
  return all.filter((c) => {
    const key = `${c.board}:${c.port ?? c.mountPath ?? ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
