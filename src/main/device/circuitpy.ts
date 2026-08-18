/**
 * CIRCUITPY DRIVES — finding a CircuitPython board's filesystem (#753, epic #209).
 * =============================================================================
 *
 * A board running CircuitPython mounts a **CIRCUITPY** volume alongside its
 * serial port. That drive is not a flashing mode — unlike `RPI-RP2` or
 * `MICROBIT`, which `firmware/detect.ts` looks for — it is the board's own
 * filesystem, and it is how a host writes to it, because while it is mounted
 * the board's code can't (#754 builds on this).
 *
 * Two things come out of finding one:
 *
 *  1. **Identity with no connection.** `boot_out.txt` names the CircuitPython
 *     version and the per-board build id, so a board can be identified before
 *     anything is connected — which is what makes a precise firmware-update
 *     check possible later (#757), CircuitPython builds being per-board rather
 *     than per-chip.
 *  2. **A write target**, once it is known which port the drive belongs to.
 *
 * That second part is the hard half. Two boards on one desk means two drives,
 * and writing a file to the wrong one is a silent, confusing failure — so the
 * pairing below refuses to guess, and reports WHY it couldn't rather than
 * picking one.
 */
import { parseBootOut, parseBootOutUid, type RuntimeInfo } from '../../shared/dialect'
import { isVirtualPort } from '../../shared/virtual-device'
import { listVolumes, readVolumeFile, type Volume } from '../fs/volumes'
import type { PortInfo } from './types'

/** The volume label CircuitPython gives its filesystem. */
const CIRCUITPY_LABEL = 'CIRCUITPY'

/** The file CircuitPython writes at boot, naming itself. */
const BOOT_OUT = 'boot_out.txt'

/** A mounted CircuitPython filesystem. */
export interface CircuitPyDrive {
  /** Absolute mount path — `/Volumes/CIRCUITPY`, `E:\`, `/media/kev/CIRCUITPY`. */
  mountPath: string
  /** What `boot_out.txt` says the board is running. */
  runtime: RuntimeInfo
  /** The board's unique id, when its CircuitPython is new enough to write one. */
  uid?: string
}

/**
 * How confidently a drive was tied to a port — carried so the UI can be as
 * certain as the evidence is, and no more.
 *
 * `uid` is a real identification: the board's own id, matched against the USB
 * serial number the OS reports for that port. `sole` is an inference from there
 * being exactly one of each — right almost always, but it is a deduction from
 * absence, not a match, so it is named differently.
 */
export type PairConfidence = 'uid' | 'sole'

/** The outcome of pairing drives with a port. A miss says why. */
export type DrivePairing =
  | { drive: CircuitPyDrive; confidence: PairConfidence }
  | { drive: null; why: 'no-drives' | 'ambiguous' }

/**
 * Does this volume look like a CircuitPython filesystem?
 *
 * The label is the strong signal but is unavailable on Windows (a volume is a
 * bare drive letter), and a user can rename the drive — CircuitPython lets you,
 * and people do. So the marker file is what actually decides, with the label
 * only saving a `readdir` on the common path.
 */
async function readCircuitPyVolume(vol: Volume): Promise<CircuitPyDrive | null> {
  // A labelled volume is always worth reading. An unlabelled one only where
  // reading is cheap — see `Volume.probeContents`.
  const labelled = vol.name.toUpperCase() === CIRCUITPY_LABEL
  if (!labelled && !vol.probeContents) return null
  const text = await readVolumeFile(vol.mountPath, BOOT_OUT)
  if (text === null) return null
  const runtime = parseBootOut(text)
  // A `boot_out.txt` that parses as neither runtime is not a board we know.
  if (!runtime) return null
  const drive: CircuitPyDrive = { mountPath: vol.mountPath, runtime }
  const uid = parseBootOutUid(text)
  if (uid) drive.uid = uid
  return drive
}

/**
 * Every mounted CircuitPython filesystem, right now.
 *
 * Deliberately un-cached: a drive ejects on soft reboot and comes back a moment
 * later, so a cache would confidently name a mount point that no longer exists.
 * Scanning is a handful of `readdir`s, cheap enough to just do again.
 *
 * `roots` is injectable for tests; production callers pass nothing.
 */
export async function findCircuitPyDrives(roots?: string[]): Promise<CircuitPyDrive[]> {
  const volumes = await listVolumes(roots)
  const found = await Promise.all(volumes.map(readCircuitPyVolume))
  return found.filter((d): d is CircuitPyDrive => d !== null)
}

/** Compare two board ids ignoring case and any separators the OS added. */
function sameId(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false
  const norm = (s: string): string => s.replace(/[^0-9a-z]/gi, '').toUpperCase()
  return norm(a) === norm(b)
}

/**
 * Tie a CIRCUITPY drive to a serial port, or explain why it can't be done.
 *
 * The strong path needs no connection to the board: CircuitPython writes its
 * `microcontroller.cpu.uid` into `boot_out.txt`, and USB reports that same id as
 * the port's serial number, so the two match offline.
 *
 * Failing that — an older CircuitPython writes no UID, and not every OS reports
 * a serial number — one drive and one candidate port can only be each other.
 * With more than one of either and no UID match, this returns `ambiguous` and
 * the caller must not write anything: guessing here means writing a file to
 * somebody else's board.
 *
 * Pure, so the rule is testable without mounting anything.
 */
export function pairDriveToPort(
  drives: CircuitPyDrive[],
  port: PortInfo,
  allPorts: PortInfo[] = []
): DrivePairing {
  if (drives.length === 0) return { drive: null, why: 'no-drives' }

  const byUid = drives.find((d) => sameId(d.uid, port.serialNumber))
  if (byUid) return { drive: byUid, confidence: 'uid' }

  // No id match. Only safe if there is exactly one drive AND no other board it
  // could belong to — a second board makes "the only drive" meaningless, since
  // the drive might be the OTHER one's. The simulated device is not a board and
  // has no drive, so it never counts as a rival.
  const rivals = allPorts.filter((p) => p.path !== port.path && !isVirtualPort(p.path))
  if (drives.length === 1 && rivals.length === 0) return { drive: drives[0], confidence: 'sole' }
  return { drive: null, why: 'ambiguous' }
}

/**
 * What the UI shows against a port whose board we identified from its drive —
 * the version and board id from `boot_out.txt`, plus how sure we are.
 */
export interface PortCircuitPy {
  mountPath: string
  version?: string
  boardId?: string
  confidence: PairConfidence
}

/**
 * Annotate serial ports with the CircuitPython board behind them, where that
 * can be established from a mounted drive alone.
 *
 * This is what lets the port dropdown say "CircuitPython 10.2.1" **before** the
 * user connects. A port that can't be tied to a drive is returned untouched
 * rather than annotated hopefully — the whole point of #753's pairing rule.
 */
export async function annotatePortsWithDrives(
  ports: PortInfo[],
  roots?: string[]
): Promise<PortInfo[]> {
  let drives: CircuitPyDrive[]
  try {
    drives = await findCircuitPyDrives(roots)
  } catch {
    return ports // detection is an enrichment; never let it break the port list
  }
  if (drives.length === 0) return ports
  return ports.map((port) => {
    // The simulator has no drive; annotating it would be nonsense.
    if (isVirtualPort(port.path)) return port
    const paired = pairDriveToPort(drives, port, ports)
    if (!paired.drive) return port
    const { mountPath, runtime } = paired.drive
    const circuitpy: PortCircuitPy = { mountPath, confidence: paired.confidence }
    if (runtime.version) circuitpy.version = runtime.version
    if (runtime.boardId) circuitpy.boardId = runtime.boardId
    return { ...port, circuitpy }
  })
}
