import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { describeIdentity, suggestedBuildFor } from '../../../shared/esptool-identify'
import type { BoardIdentity } from '../../../shared/esptool-identify'
import type {
  BoardCandidate,
  BoardType,
  EsptoolInfo,
  FirmwareCatalog,
  FlashProgress,
  PortInfo
} from '../../../preload/index.d'
import {
  BOARD_PROFILES,
  profilesForChip,
  type BoardProfile,
  boardProfile,
  firmwareFileIssue,
  firmwareMismatch,
  methodForBoardType
} from '../../../shared/board-profiles'
import {
  FIRMWARE_RUNTIMES,
  FIRMWARE_RUNTIME_HOST,
  FIRMWARE_RUNTIME_ICON,
  FIRMWARE_RUNTIME_LABEL,
  findBoardBuilds,
  flashTargetForDownload,
  catalogBuildForBoard,
  siblingBuildUrl,
  flashTargetForFamily,
  isVendorUf2Family,
  type FirmwareRuntime
} from '../../../shared/firmware-runtime'
import {
  replPortConflict,
  heldSerialPort,
  retryAction,
  type PortConflict
} from '../../../shared/flash-dialog'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { useDeviceStatus } from '../hooks/useDeviceStatus'
import { hasWebUSB, isElectron } from '../lib/platform'
import { flashEspInBrowser, requestEspPort } from '../lib/webFirmware/espFlash'
import { flashMicrobitInBrowser, requestMicrobitDevice } from '../lib/webFirmware/microbitFlash'
import { copyFirmwareToDrive } from '../lib/webFirmware/driveCopyFlash'
import { BoardFinder } from './BoardFinder'
import {
  FLASH_BOARD_EVENT,
  flasherSelectionFor,
  type BoardFlashRequest
} from './board-finder-bus'
import './FirmwareFlasher.css'

interface FirmwareFlasherProps {
  /** Close the modal (ignored while a flash is in progress). */
  onClose: () => void
  /**
   * Which runtime the dialog OPENS on (#756). The user can always change it; this
   * only saves a step when the caller already knows — the status bar passes the
   * connected board's own dialect, so a CircuitPython board doesn't open on a
   * MicroPython catalog.
   */
  runtime?: FirmwareRuntime
  /**
   * The connected board's CircuitPython **Board ID**, when one could be
   * established (`boot_out.txt`, #753). Used to pre-select that board's exact
   * build. Absent means we could not identify the board, and the dialog says so
   * rather than pre-selecting a plausible-looking one.
   */
  boardId?: string
}

const BOARD_LABELS: Record<BoardType, string> = {
  esp32: 'ESP32 (esptool)',
  esp8266: 'ESP8266 (esptool)',
  rp2040: 'RP2040 / Pico (UF2)',
  microbit: 'BBC micro:bit (.hex)'
}

/** Default ESP offsets shown in the UI; user can override per board. */
const DEFAULT_OFFSET: Record<BoardType, string> = {
  esp32: '0x1000',
  esp8266: '0x0',
  rp2040: '',
  microbit: ''
}

/** ESP boards flash via esptool (port + offset); the rest copy a file to a drive. */
function isEspBoard(b: BoardType): boolean {
  return b === 'esp32' || b === 'esp8266'
}

/** Where the firmware to flash comes from (`.uf2` or `.bin`). */
type Source = 'local' | 'catalog'

/**
 * FIRMWARE FLASHER MODAL (issues #14, #64, #125; Web W3 issue #284).
 *
 * Lets the user flash MicroPython firmware to a device without leaving Snakie:
 *  - auto-detects board candidates (serial VID/PID for ESP, RPI-RP2 UF2 drive),
 *  - for ANY board, picks the firmware EITHER by browsing a local file
 *    (`.bin` for ESP, `.uf2` for RP2040) OR by downloading one from
 *    MicroPython.org via Thonny's curated catalog (Family → Model → Variant →
 *    Version cascade) — issue #64 (UF2) + issue #125 (ESP `.bin` via esptool),
 *  - flashes RP2040 by copying the UF2 onto the boot drive, ESP via esptool at
 *    the per-chip offset,
 *  - streams a live log + a % progress bar (download then copy/flash), with a
 *    Done button once the flash finishes (success or failure).
 *
 * For a CATALOG flash the selected *family* is authoritative for the flash
 * target: picking a family syncs the Board type + offset via
 * {@link flashTargetForFamily}, so the right inputs (port/offset for ESP, boot
 * drive for RP2040) surface automatically.
 *
 * In Electron, all heavy lifting happens in the main process via
 * `window.api.firmware`. Outside Electron (a browser tab — Web W3, issue
 * #284) there's no process to shell out to, so every board flashes entirely
 * client-side instead, over whichever browser API fits it:
 *  - ESP32/ESP8266: Web Serial via Espressif's `esptool-js`
 *    (`lib/webFirmware/espFlash.ts`).
 *  - micro:bit: WebUSB/DAPLink via ARM's `dapjs`
 *    (`lib/webFirmware/microbitFlash.ts`), the same approach MakeCode uses —
 *    with an explicit "copy to drive instead" fallback for browsers/boards
 *    where WebUSB DAPLink doesn't respond.
 *  - RP2040 (BOOTSEL): there's no WebUSB interface to talk to in bootloader
 *    mode, so this ALWAYS uses the guided drive-copy flow below.
 *  - The guided drive-copy flow (`lib/webFirmware/driveCopyFlash.ts`) talks
 *    the user through the manual mount step (hold BOOTSEL / plug in), then
 *    uses the File System Access API's save-file picker to write the
 *    firmware onto whichever drive they pick.
 * A browser-native firmware-catalog fetch isn't implemented yet, so the
 * catalog-download source is hidden outside Electron; only "Local file" is
 * offered there. `isElectron()`/`hasWebUSB()` from `lib/platform` decide
 * which path a given render takes.
 *
 * **Which Python** (#756, epic #209). The dialog used to be MicroPython all the
 * way down, with no way to say otherwise. A Runtime choice now sits at the top
 * and drives everything below it: which catalogs are fetched (micropython.org's
 * or circuitpython.org's), what the copy says, and — for CircuitPython, whose
 * builds are per BOARD rather than per chip — which board's build is
 * pre-selected, matched on the Board ID from `boot_out.txt`. When that id can't
 * be established the dialog says so and pre-selects nothing: a guessed `.uf2`
 * flashes without complaint and leaves a board needing a re-flash.
 */
export function FirmwareFlasher({
  onClose,
  runtime: initialRuntime,
  boardId
}: FirmwareFlasherProps): JSX.Element {
  const [candidates, setCandidates] = useState<BoardCandidate[]>([])
  /** Every serial port on the machine, so a board whose USB bridge detection did
   *  not recognise can still be selected (#821). */
  const [ports, setPorts] = useState<PortInfo[]>([])
  /** What the connected board said about itself, once asked (esptool flash-id).
   *  Null until the user asks; `{}` when the board could not be reached. */
  const [identity, setIdentity] = useState<BoardIdentity | null>(null)
  const [identifying, setIdentifying] = useState(false)
  /**
   * Detect could not run because the REPL has the port (#845).
   *
   * Set by Detect rather than derived from the connection, so the message
   * appears because an action was taken and could not be carried out — not as a
   * standing warning next to a board somebody is happily using.
   */
  const [detectConflict, setDetectConflict] = useState<PortConflict | null>(null)
  const [disconnecting, setDisconnecting] = useState(false)
  /**
   * Whether the advanced fields are showing (#833). Closed by default.
   *
   * Everything behind it is either derived from the board once it is known — the
   * flash offset, the board type, whether to erase — or a decision nobody should
   * have to make to put MicroPython on a board they just plugged in. It opens by
   * ITSELF when the board could not be worked out, because that is exactly when
   * those fields stop being noise and become the only way through.
   */
  const [advancedOpen, setAdvancedOpen] = useState(false)
  /** Profiles that claim the identified chip, when more than one does — a
   *  question for the user rather than a guess we make for them. */
  const [matchedProfiles, setMatchedProfiles] = useState<BoardProfile[]>([])
  /** A CONFIRMED URL for the recommended build, when the catalog does not carry
   *  it but micropython.org publishes it alongside the one that is selected. */
  const [recommendedUrl, setRecommendedUrl] = useState<string | null>(null)
  /** Whether to flash that build instead of the catalog's. On by default when
   *  one is found — it is recommended because it is the better fit. */
  const [useRecommended, setUseRecommended] = useState(true)
  const [board, setBoard] = useState<BoardType>('esp32')
  /** The chosen board profile (#682) — drives the mechanics below it. */
  const [profileId, setProfileId] = useState<string>('')
  /** Erase the whole flash before writing (#683). */
  // Defaults ON: the dialog opens on an ESP board, and a stale flash is the more
  // likely hazard than a wasted seven seconds (#826).
  const [eraseFirst, setEraseFirst] = useState<boolean>(true)
  /** Brief "Copied" confirmation on the copy-log button (#685). */
  const [copied, setCopied] = useState(false)
  /**
   * Mirrors {@link profileId} for the async board detection (#684).
   *
   * Detection `await`s a port scan AND an esptool check, so it commonly resolves
   * AFTER the user has picked a board — and it captured `profileId` as it was
   * when the effect ran, i.e. empty. Reading the ref lets it see a choice made
   * while it was in flight.
   */
  const profileRef = useRef<string>('')
  const [port, setPort] = useState<string>('')
  const [mountPath, setMountPath] = useState<string>('')
  const [offset, setOffset] = useState<string>(DEFAULT_OFFSET.esp32)
  const [firmwarePath, setFirmwarePath] = useState<string>('')
  // The picked firmware's raw bytes, for the browser flash paths, which have
  // no filesystem path to hand to esptool/dapjs — only a `File` (Web W3).
  const [webFirmwareBytes, setWebFirmwareBytes] = useState<Uint8Array<ArrayBuffer> | null>(null)
  const webFileInputRef = useRef<HTMLInputElement>(null)
  // For a browser micro:bit flash: false tries WebUSB/DAPLink first (the
  // default when the browser supports it); true skips straight to the
  // guided drive-copy flow, either because the user hit the explicit
  // fallback button or because this browser has no WebUSB at all.
  const [microbitUseDriveCopy, setMicrobitUseDriveCopy] = useState(false)
  const [esptool, setEsptool] = useState<EsptoolInfo | null>(null)
  // Generation of a detected micro:bit (v1/v2), to pre-select the right firmware.
  const [detectedMicrobit, setDetectedMicrobit] = useState<'v1' | 'v2' | undefined>(undefined)
  const [log, setLog] = useState<FlashProgress[]>([])
  const [percent, setPercent] = useState<number | null>(null)
  const [flashing, setFlashing] = useState(false)
  const [outcome, setOutcome] = useState<'idle' | 'success' | 'error'>('idle')
  const logRef = useRef<HTMLDivElement>(null)
  /** Whether the output follows the newest line. Off lets you scroll back and
   *  READ while a flash is still writing to it — esptool's output is long, and
   *  the interesting parts (the chip banner, the detected flash size) are at the
   *  top, where autoscroll drags you away from them. */
  const [autoScroll, setAutoScroll] = useState(true)
  // Move focus into the dialog on open, trap Tab, and restore it on close.
  const dialogRef = useFocusTrap<HTMLDivElement>()

  /**
   * The live REPL connection — because esptool and the REPL want the same port
   * and only one of them can have it (#845).
   *
   * Mirrored into a ref for the same reason `profileRef` is: Detect `await`s a
   * port scan before it needs this, by which point the callback's captured
   * `status` can be a connection ago.
   */
  const deviceStatus = useDeviceStatus()
  const statusRef = useRef(deviceStatus)
  useEffect(() => {
    statusRef.current = deviceStatus
    // A board disconnected by any route — this dialog's button, the status bar,
    // unplugging it — settles the question, so retract the message rather than
    // leave it accusing a port nobody holds.
    if (!heldSerialPort(deviceStatus)) setDetectConflict(null)
  }, [deviceStatus])

  // --- Which Python is being flashed (#756) ---
  const [runtime, setRuntime] = useState<FirmwareRuntime>(initialRuntime ?? 'micropython')
  const runtimeLabel = FIRMWARE_RUNTIME_LABEL[runtime]

  // --- Catalog (download-from-micropython.org / circuitpython.org) state (#64) ---
  // Default to the catalog rather than a local file (#833). Downloading the
  // official build is what almost everyone wants and needs no prior knowledge;
  // picking a file off disk assumes you have already been somewhere else and
  // come back with the right one.
  /**
   * The Board Finder gallery (#893), opened from the button beside Detect board.
   *
   * It lives INSIDE the dialog rather than beside it in the status bar, because
   * "which board is this?" is a question you have while the flasher is open —
   * and answering it there means the pick lands in the dialog you are already
   * looking at instead of opening a second one.
   */
  const [finderOpen, setFinderOpen] = useState(false)
  const [finderOrigin, setFinderOrigin] = useState<{ x: number; y: number } | null>(null)
  // Closing runs the grow backwards, so the gallery has to outlive the click
  // that dismissed it — unmount on the click and there is nothing left to
  // animate.
  const [finderClosing, setFinderClosing] = useState(false)
  const dropFinder = useCallback((): void => {
    setFinderClosing(false)
    setFinderOpen(false)
  }, [])
  const closeFinder = useCallback((): void => {
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (!finderOrigin || still) dropFinder()
    else setFinderClosing(true)
  }, [finderOrigin, dropFinder])
  // Insurance: the unmount hangs off `animationend`, and a closing panel has
  // pointer events off. If that event never arrives the gallery would be stuck
  // on screen AND unclickable, so time it out regardless.
  useEffect(() => {
    if (!finderClosing) return
    const t = setTimeout(dropFinder, 450)
    return () => clearTimeout(t)
  }, [finderClosing, dropFinder])

  /**
   * Take a board the gallery picked.
   *
   * Through the same window event the gallery already dispatches, rather than a
   * callback prop: the flasher IS mounted when the gallery is open inside it, so
   * it can simply listen, and the gallery needs no knowledge of who opened it.
   */
  useEffect(() => {
    const onFlashBoard = (e: Event): void => {
      const pick = flasherSelectionFor((e as CustomEvent<BoardFlashRequest>).detail)
      setBoard(pick.board)
      if (pick.offset) setOffset(pick.offset)
      setSource('catalog')
      setSelFamily(pick.family)
      setSelVersionUrl(pick.url)
      dropFinder()
    }
    window.addEventListener(FLASH_BOARD_EVENT, onFlashBoard)
    return () => window.removeEventListener(FLASH_BOARD_EVENT, onFlashBoard)
  }, [dropFinder])

  const [source, setSource] = useState<Source>('catalog')
  const [catalog, setCatalog] = useState<FirmwareCatalog | null>(null)
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [selFamily, setSelFamily] = useState<string>('')
  const [selModel, setSelModel] = useState<string>('')
  const [selVariant, setSelVariant] = useState<string>('')
  const [selVersionUrl, setSelVersionUrl] = useState<string>('')

  const isEsp = board === 'esp32' || board === 'esp8266'
  // In the browser, micro:bit flashes via WebUSB/DAPLink unless the browser
  // lacks WebUSB or the user chose the drive-copy fallback; RP2040 always
  // uses drive-copy (BOOTSEL has no WebUSB interface).
  const browserMicrobitViaWebUsb =
    !isElectron() && board === 'microbit' && hasWebUSB() && !microbitUseDriveCopy
  const browserDriveCopy =
    !isElectron() && (board === 'rp2040' || (board === 'microbit' && !browserMicrobitViaWebUsb))

  // A single handler for a streamed progress line, shared by BOTH the
  // Electron IPC subscription below AND the browser (Web Serial) flash path,
  // which calls this directly instead of going through `window.api`.
  const handleProgress = useCallback((p: FlashProgress): void => {
    setLog((prev) => [...prev, p])
    if (typeof p.percent === 'number') setPercent(p.percent)
    if (p.kind === 'done') {
      setFlashing(false)
      setOutcome(p.ok ? 'success' : 'error')
    }
  }, [])

  // Subscribe to streamed progress for the lifetime of the modal (Electron only).
  useEffect(() => {
    const unsubscribe = window.api.firmware.onProgress(handleProgress)
    return unsubscribe
  }, [handleProgress])

  // Follow the newest line — unless the user has asked us not to.
  //
  // `autoScroll` is a dependency as well as a guard, so switching it back ON
  // jumps to the bottom straight away rather than leaving the view stranded
  // until the next line happens to arrive.
  useEffect(() => {
    if (!autoScroll) return
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [log, autoScroll])

  // Escape closes the dialog (consistent with the other modals), but never
  // mid-flash — interrupting a flash could leave the device half-written.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !flashing) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [flashing, onClose])

  const refreshDetection = useCallback(async (): Promise<BoardCandidate[] | undefined> => {
    try {
      const [found, tool, allPorts] = await Promise.all([
        window.api.firmware.detectBoards(),
        window.api.firmware.checkEsptool(),
        // Best-effort and independent of detection: a port we cannot identify
        // still needs offering (#821).
        window.api.device.listPorts().catch(() => [] as PortInfo[])
      ])
      setCandidates(found)
      setEsptool(tool)
      setPorts(allPorts)
      // Adopt the first detected candidate as a sensible default — but NEVER
      // over an explicitly chosen board (#684). Detection only knows the coarse
      // BoardType, whose ESP offset is the original ESP32's 0x1000; silently
      // applying that over a profile's 0x0 is what made an ESP32-S3 flash to the
      // wrong address after the user had picked the right board.
      const first = found[0]
      if (first && !profileRef.current) {
        setBoard(first.board)
        setOffset(DEFAULT_OFFSET[first.board])
        // port / mountPath / detectedMicrobit are derived from the selected board
        // by the effect below, so a board switch can't keep a stale target.
      }
      return found
    } catch {
      // Detection is best-effort; leave manual selection available.
      return undefined
    }
  }, [])

  useEffect(() => {
    void refreshDetection()
  }, [refreshDetection])

  // Re-point the flash target at a detected candidate for the SELECTED board
  // whenever the board (manual pick or catalog family sync) or the detected set
  // changes — and clear it when none match. Prevents flashing to the wrong drive
  // (e.g. a micro:bit `.hex` onto a previously-detected RP2040 boot drive) now
  // that two different boards both flash via a mounted drive.
  useEffect(() => {
    const match = candidates.find((c) => c.board === board)
    setPort(match?.port ?? '')
    setMountPath(match?.mountPath ?? '')
    setDetectedMicrobit(match?.board === 'microbit' ? match.microbitVersion : undefined)
  }, [board, candidates])

  /**
   * Copy the whole log for troubleshooting (#685).
   *
   * The whole log, not the visible part: what matters when a flash goes wrong is
   * usually the chip/feature banner at the top, which has scrolled away by the
   * time it finishes. Strips the terminal escape sequences esptool emits to
   * redraw its progress bar, so what lands on the clipboard is readable.
   */
  const copyLog = useCallback(async (): Promise<void> => {
    // eslint-disable-next-line no-control-regex
    const clean = (t: string): string => t.replace(/\u001b?\[[0-9;]*[A-Za-z]/g, '').trimEnd()
    const text = log
      .map((l) => clean(l.message))
      .filter((l) => l !== '')
      .join('\n')
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      // Clipboard denied (or no permission outside a secure context) — say so
      // rather than silently doing nothing.
      setLog((cur) => [...cur, { kind: 'error', message: 'Could not copy — your browser blocked clipboard access.' }])
    }
  }, [log])

  const handleBoardChange = useCallback((next: BoardType): void => {
    // Changing the coarse type by hand means going manual: drop the profile
    // rather than leave it claiming settings the user has just overridden.
    setProfileId('')
    profileRef.current = ''
    setBoard(next)
    setOffset(DEFAULT_OFFSET[next])
    // Reset the drive-copy opt-in so switching away from and back to
    // micro:bit re-tries WebUSB/DAPLink first (Web W3, issue #284).
    setMicrobitUseDriveCopy(false)
    // The catalog now serves ESP (`.bin`) and RP2040 (`.uf2`) alike (issue
    // #125), so the source is no longer gated by board.
  }, [])

  const handlePickFile = useCallback(async (): Promise<void> => {
    // Outside Electron there's no filesystem-path picker IPC to call — open a
    // regular `<input type=file>` instead and read the bytes directly (Web W3).
    if (!isElectron()) {
      webFileInputRef.current?.click()
      return
    }
    try {
      // Ask only for what this board can be flashed with, so the dialog can't
      // offer a file that could never work (#686).
      const picked = await window.api.firmware.pickFirmwareFile(
        profileRef.current ? boardProfile(profileRef.current)?.method : methodForBoardType(board)
      )
      if (picked) setFirmwarePath(picked)
    } catch {
      // Cancelled / unavailable — keep the current selection.
    }
    // `board` is read for the dialog filter; `profileRef` is a ref and needs no dep.
  }, [board])

  // Handles the hidden browser file input's change event: reads the picked
  // file into bytes for `flashEspInBrowser` and shows its name in the
  // existing (read-only) "firmware file" text field for display purposes.
  const handleWebFileChange = useCallback(async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same file later
    if (!file) return
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      setWebFirmwareBytes(bytes)
      setFirmwarePath(file.name)
    } catch {
      // Ignore unreadable files; keep the previous selection.
    }
  }, [])

  // --- Catalog cascade helpers (issue #64) ---

  const loadCatalog = useCallback(async (): Promise<void> => {
    setCatalogLoading(true)
    setCatalogError(null)
    try {
      const fetched = await window.api.firmware.fetchCatalog(runtime)
      setCatalog(fetched)
    } catch (err) {
      setCatalog(null)
      setCatalogError(err instanceof Error ? err.message : String(err))
    } finally {
      setCatalogLoading(false)
    }
  }, [runtime])

  // When the user switches to the catalog source (any board), fetch it once.
  useEffect(() => {
    if (source !== 'catalog') return
    if (!catalog && !catalogLoading && !catalogError) void loadCatalog()
  }, [source, catalog, catalogLoading, catalogError, loadCatalog])

  /**
   * Switching runtime throws the catalog away rather than filtering it: the two
   * are different lists of different builds, and a selection carried across
   * would name a build that no longer exists. The fetch effect above then
   * re-runs for the new runtime.
   */
  const handleRuntimeChange = useCallback((next: FirmwareRuntime): void => {
    setRuntime(next)
    setCatalog(null)
    setCatalogError(null)
    setSelFamily('')
    setSelModel('')
    setSelVariant('')
    setSelVersionUrl('')
  }, [])

  const families = useMemo(() => catalog?.families ?? [], [catalog])
  const family = useMemo(
    () => families.find((f) => f.family === selFamily),
    [families, selFamily]
  )
  const models = useMemo(() => family?.models ?? [], [family])

  const profile = useMemo(() => (profileId ? boardProfile(profileId) : undefined), [profileId])

  /**
   * Pick the actual BOARD, and everything mechanical follows (#682).
   *
   * The offset is the reason this exists. Only the original ESP32 flashes at
   * `0x1000`; every other ESP chip is `0x0`. Choosing "ESP32" from the board TYPE
   * list and browsing to an ESP32-S3 binary wrote it at `0x1000` — esptool
   * reported success, the ROM found no bootloader, and the board never came back
   * as a REPL. Naming the board removes the chance to get that wrong.
   */
  const handleProfileChange = useCallback(
    (id: string): void => {
      setProfileId(id)
      profileRef.current = id
      const p = boardProfile(id)
      if (!p) return
      const next: BoardType =
        p.method === 'uf2' ? 'rp2040' : p.method === 'daplink' ? 'microbit' : p.chipFamily === 'esp8266' ? 'esp8266' : 'esp32'
      setBoard(next)
      setOffset(p.offset ?? DEFAULT_OFFSET[next])
      // Erase-before-write defaults ON for esptool boards; a profile opts OUT
      // by setting `eraseByDefault: false` (#826). Opting in was the wrong way
      // round — the stale-flash hazard belongs to whatever was on the board
      // before, which no profile can know.
      setEraseFirst(p.method === 'esptool' && p.eraseByDefault !== false)
      // Pre-select the firmware family too, so the catalog opens on builds that
      // fit — a generic build is keyed on the chip, which the profile knows.
      if (families.some((f) => f.family === p.chipFamily)) setSelFamily(p.chipFamily)
    },
    [families]
  )

  const model = useMemo(
    () => models.find((m) => `${m.vendor}|${m.model}` === selModel),
    [models, selModel]
  )
  const variants = useMemo(() => model?.variants ?? [], [model])
  const variant = useMemo(
    () => variants.find((v) => v.title === selVariant),
    [variants, selVariant]
  )
  const versions = useMemo(() => variant?.versions ?? [], [variant])

  /**
   * The CircuitPython Board ID we are working with, if any (#756).
   *
   * A board named by hand wins over one detected from a drive: the user has just
   * told us what they are holding. Empty when neither is known — CircuitPython
   * builds are per board, so an unknown board means we offer nothing rather than
   * pre-select something that looks close.
   */
  const activeBoardId = profileId ? (profile?.circuitPythonBoardId ?? '') : (boardId ?? '')

  /** Every CircuitPython build published for that board (`.uf2` and `.bin` both,
   *  where a board has both). Empty for MicroPython, whose builds are per chip. */
  const boardBuilds = useMemo(
    () => (runtime === 'circuitpython' ? findBoardBuilds(catalog, activeBoardId) : []),
    [runtime, catalog, activeBoardId]
  )

  /**
   * Which of those to open on. A drive copy is preferred where the board offers
   * one: it needs no esptool on PATH and has no offset to get wrong.
   */
  const matchedBuild = useMemo(() => {
    const driveCopy = boardBuilds.find(
      (b) => flashTargetForDownload(b.family, b.variant.versions[0]?.url ?? '').board === 'rp2040'
    )
    return driveCopy ?? boardBuilds[0]
  }, [boardBuilds])

  const matchKey = matchedBuild
    ? `${matchedBuild.family}|${matchedBuild.model.label}|${matchedBuild.variant.title}`
    : ''
  /** The match already applied to the dropdowns, so a user's later change sticks. */
  const appliedMatchRef = useRef<string>('')

  // Pre-select a sensible Family once the catalog arrives: prefer one whose
  // flash target matches the currently selected board (so an ESP user lands on
  // an ESP family), then `rp2`, then the first family. For a detected micro:bit,
  // prefer the family matching its generation (nrf52 for v2, nrf51 for v1).
  // A CircuitPython board matched by its Board ID overrides this entirely (the
  // effects below run after it and are far more precise).
  useEffect(() => {
    if (families.length === 0) return
    if (selFamily && families.some((f) => f.family === selFamily)) return
    const microbitFamily =
      board === 'microbit'
        ? families.find((f) => f.family === (detectedMicrobit === 'v1' ? 'nrf51' : 'nrf52'))
        : undefined
    const matchesBoard = families.find((f) => flashTargetForFamily(f.family).board === board)
    const preferred =
      microbitFamily ?? matchesBoard ?? families.find((f) => f.family === 'rp2') ?? families[0]
    setSelFamily(preferred.family)
  }, [families, selFamily, board, detectedMicrobit])

  // Point the cascade at the matched board's family. Declared AFTER the generic
  // pre-select above so that, on the render where both fire, this one's write is
  // the one that lands.
  useEffect(() => {
    if (!matchedBuild || appliedMatchRef.current === matchKey) return
    setSelFamily(matchedBuild.family)
  }, [matchedBuild, matchKey])

  // Reset downstream selections whenever the upstream selection changes.
  useEffect(() => {
    setSelModel('')
    setSelVariant('')
    setSelVersionUrl('')
  }, [selFamily])

  // …then select the matched Model + Variant, once the family has settled (and
  // AFTER the reset above, which would otherwise wipe them in the same commit).
  useEffect(() => {
    if (!matchedBuild || appliedMatchRef.current === matchKey) return
    if (selFamily !== matchedBuild.family) return
    appliedMatchRef.current = matchKey
    setSelModel(`${matchedBuild.model.vendor}|${matchedBuild.model.model}`)
    setSelVariant(matchedBuild.variant.title)
  }, [matchedBuild, matchKey, selFamily])

  // Auto-pick the sole variant + newest version once a Model is chosen.
  useEffect(() => {
    if (variants.length === 1) setSelVariant(variants[0].title)
  }, [variants])

  useEffect(() => {
    if (versions.length > 0) setSelVersionUrl(versions[0].url)
    else setSelVersionUrl('')
  }, [versions])

  // For a CATALOG flash the selection is authoritative: sync the Board type to
  // its flash target and pre-fill the offset (still user-editable in the Flash
  // offset field) per chip (issue #125). This surfaces the right inputs
  // (port/offset for ESP, boot drive for a UF2 board) automatically.
  //
  // Once a VERSION is picked its URL decides, not the family — on CircuitPython
  // the same ESP32-S3 board is published both as a `.uf2` and as a `.bin`, and
  // handing the `.uf2` to esptool writes the container and kills the board.
  useEffect(() => {
    if (source !== 'catalog' || !selFamily) return
    const target = selVersionUrl
      ? flashTargetForDownload(selFamily, selVersionUrl)
      : flashTargetForFamily(selFamily)
    setBoard(target.board)
    setOffset(target.offset ?? DEFAULT_OFFSET[target.board])
  }, [source, selFamily, selVersionUrl])

  /**
   * Ask the board what it is, and use the answer (#829).
   *
   * The PSRAM bit is the point. MicroPython publishes ESP32_GENERIC and
   * ESP32_GENERIC-SPIRAM separately and only the second can use the PSRAM, but
   * the firmware catalog does not say which a board has — Thonny's `ESP32 /
   * WROOM` entry carries no variants at all. The board knows, and esptool will
   * ask it.
   */
  const identifyBoard = useCallback(async (portOverride?: string): Promise<boolean> => {
    // Detection has only just set state, so a caller that has a port in hand
    // passes it rather than waiting a render for it.
    const target = portOverride ?? port
    if (!target) return false
    setIdentifying(true)
    setMatchedProfiles([])
    try {
      const id = await window.api.firmware.identifyBoard(target)
      setIdentity(id)

      // ACT on what came back, rather than reporting it and leaving the user to
      // find the right entry in a list of fifteen.
      //
      // This is the gap the reporter hit: the dialog ran detection AND
      // identification, learned the board was an ESP32-PICO-V3-02 with PSRAM,
      // and still sat on "Other / set up manually" — so the flash offset, the
      // erase default and the BOOT/RESET note all had to be got right by hand.
      // Identify is an explicit "tell me what this is", so applying the answer
      // is what was asked for.
      const matches = profilesForChip(id.chip)
      if (matches.length === 1) {
        handleProfileChange(matches[0].id)
        return true
      } else if (matches.length > 1) {
        // Two boards on the same chip. Picking one would mean guessing at the
        // flash offset, so offer them instead.
        setMatchedProfiles(matches)
      } else if (id.family && families.some((f) => f.family === id.family)) {
        // No board recognised, but the CHIP FAMILY is still worth acting on:
        // it opens the catalog on builds that fit. Never over an explicit
        // choice — same rule as detection.
        if (!profileRef.current) setSelFamily(id.family)
      }
      // More than one claimant is still a resolved question — the user just has
      // to answer it — so it does not count as "could not tell".
      return matches.length > 1
    } catch {
      setIdentity({})
      return false
    } finally {
      setIdentifying(false)
    }
  }, [port, families, handleProfileChange])

  /**
   * ONE action for "what have I plugged in" (#833).
   *
   * Detect scanned USB for a board; Identify asked that board what it was. Two
   * buttons for two halves of one question, which meant knowing that both
   * existed and that you wanted both — and the second only worked after the
   * first had set a port. Nobody plugging in a board wants two verbs for that.
   *
   * When it cannot work the board out it opens the advanced fields, because at
   * that point they stop being clutter and become the only way through. When it
   * can, they stay shut: there is nothing left to decide.
   *
   * `portIsFree` is set only by {@link disconnectAndDetect}, which has just let
   * go of the port itself: the `device:status` push confirming that has not
   * arrived yet, so the check below would still see the connection it just
   * closed.
   */
  const detectBoard = useCallback(async (portIsFree = false): Promise<void> => {
    const found = await refreshDetection()
    const serial = (found ?? []).find((c) => c.source === 'serial')
    // A UF2 / drive board has no esptool to interrogate, so detection alone
    // settles it — a mount that was found counts as a success.
    const drive = (found ?? []).some((c) => c.source !== 'serial')
    /**
     * Ask BEFORE esptool does (#845). A port Snakie holds for the REPL cannot be
     * opened a second time, and `identifyBoard` reports that failure as an EMPTY
     * identity — the same answer a board that is simply not in download mode
     * gives. So the dialog said "hold BOOT, tap RESET", which cannot possibly fix
     * a port held by the app doing the asking, and the real cause went unsaid.
     *
     * A drive board is exempt: nothing about it goes through the serial port, so
     * an RP2040 in BOOTSEL is flashable with a REPL open on something else.
     */
    const conflict =
      portIsFree || (drive && !serial)
        ? null
        : replPortConflict(statusRef.current, serial?.port)
    setDetectConflict(conflict)
    // Disconnecting is the way through this one; the advanced fields are not.
    if (conflict) return
    const known = serial?.port ? await identifyBoard(serial.port) : false
    if (!known && !drive) setAdvancedOpen(true)
  }, [refreshDetection, identifyBoard])

  /**
   * Hand the port back, then detect (#845).
   *
   * Snakie could take the port without asking — it has to end up free either
   * way, since flashing needs it too. It asks because the board may be part-way
   * through something: dropping the REPL stops whatever is running, empties the
   * shell and takes every instrument's live feed with it. That is a fine thing
   * to do on purpose and a bad thing to have happen to you, so it is one button
   * with its consequence written on it rather than a silent side effect of
   * pressing Detect.
   */
  const disconnectAndDetect = useCallback(async (): Promise<void> => {
    setDisconnecting(true)
    try {
      await window.api.device.disconnect()
    } catch {
      // Already gone, or never really open — either way the port is free now,
      // and detection below is the honest way to find out what is on it.
    } finally {
      setDisconnecting(false)
    }
    await detectBoard(true)
  }, [detectBoard])

  /**
   * The build worth flashing for this board, from whichever source knows.
   *
   * The PROFILE first: `preferredBuild` is authored and checked by a human, and
   * it is available the moment a board is selected — no interrogation needed.
   * The board's own report is the fallback, for a board with no profile.
   *
   * Reading only the identity was a real gap: the Feather V2 profile has named
   * ESP32_GENERIC-SPIRAM all along and the dialog ignored it, so unless you had
   * pressed Detect AND identification had succeeded, the plain build was
   * downloaded — on a board that needs the SPIRAM one.
   */
  const suggestedBuild = useMemo(
    () => profile?.preferredBuild ?? (identity ? suggestedBuildFor(identity) : null),
    [profile, identity]
  )

  /**
   * Find the recommended build, if micropython.org actually publishes it (#833).
   *
   * The catalog cannot offer it — Thonny's `ESP32 / WROOM` entry has no variants
   * — so the dialog used to name the build and stop there, leaving a browser, a
   * downloads folder and a file picker between the user and a file whose address
   * is derivable from the one already selected. Derive it, CONFIRM it resolves,
   * and then it is just another thing Flash can fetch.
   */
  /**
   * Every download the selected family offers, so the recommended build can be
   * derived from ONE of them when the user has selected nothing (#885).
   */
  const familyBuildUrls = useMemo(
    () =>
      (families.find((f) => f.family === selFamily)?.models ?? []).flatMap((m) =>
        m.variants.flatMap((v) => v.versions.map((x) => x.url))
      ),
    [families, selFamily]
  )

  useEffect(() => {
    const name = suggestedBuild?.name
    // A starting URL to rewrite. The user's selection when there is one — and
    // otherwise any build of the same board, because a board with no catalog
    // entry of its own (the Feather V2) can never make a selection, and it is
    // exactly that board whose profile names a build worth flashing.
    const base = selVersionUrl || catalogBuildForBoard(familyBuildUrls, name ?? '')
    if (!name || !base) {
      setRecommendedUrl(null)
      return undefined
    }
    const candidate = siblingBuildUrl(base, name)
    if (!candidate || (selVersionUrl && candidate === selVersionUrl)) {
      setRecommendedUrl(null)
      return undefined
    }
    let alive = true
    // Composed from a naming convention, so it is a guess until checked. A 404
    // handed to the flasher would be worse than the manual download it replaces.
    void window.api.firmware
      .firmwareUrlExists(candidate)
      .then((ok) => {
        if (alive) setRecommendedUrl(ok ? candidate : null)
      })
      .catch(() => {
        if (alive) setRecommendedUrl(null)
      })
    return () => {
      alive = false
    }
  }, [suggestedBuild?.name, selVersionUrl, familyBuildUrls])

  /** The URL Flash will actually fetch. */
  const flashUrl = recommendedUrl && useRecommended ? recommendedUrl : selVersionUrl

  const serialCandidates = candidates.filter((c) => c.source === 'serial')
  // Every OTHER serial port — the ones whose USB bridge we did not recognise.
  //
  // Detection keys off a VID/PID table (`ESP_USB_BRIDGES`), and that table is
  // always going to be behind the market: Adafruit moved the ESP32 Feather V2
  // onto a CH9102F and the board became unflashable, because an unmatched port
  // was simply dropped and the dropdown is built from matches alone (#821).
  //
  // A board we cannot identify is not the same as a board that is not there.
  // Offering the port, plainly marked as unrecognised, turns a dead end into a
  // choice — the user picks the board type themselves, which is exactly what the
  // manual path below already supports.
  const unknownPorts = ports.filter((p) => !serialCandidates.some((c) => c.port === p.path))
  // Drive candidates relevant to the selected board (RP2040 vs micro:bit drives).
  const uf2Candidates = candidates.filter((c) => c.source === 'uf2-drive' && c.board === board)

  const usingCatalog = source === 'catalog'
  /**
   * The selected build is a `.uf2` for a board whose bootloader volume the
   * VENDOR names — `FEATHERBOOT`, `QTPY_BOOT`, `ARDUINO`, … — rather than
   * `RPI-RP2` (#756). The mechanism is identical, but telling a Feather owner to
   * look for an RPI-RP2 drive sends them hunting for something that will never
   * appear. Detection itself is vendor-neutral: it goes by `INFO_UF2.TXT`, the
   * marker the UF2 spec defines for exactly this purpose.
   */
  const vendorUf2 = board === 'rp2040' && usingCatalog && isVendorUf2Family(selFamily)
  /**
   * The chosen file is the wrong KIND for how this board flashes (#685).
   *
   * Only for a local file — a catalog download always serves the right kind.
   */
  const fileIssue = useMemo(
    () =>
      usingCatalog || !firmwarePath
        ? null
        : firmwareFileIssue(profile?.method ?? methodForBoardType(board), firmwarePath),
    [usingCatalog, firmwarePath, profile?.method, board]
  )
  /** Warn when the chosen firmware is for a different chip than the chosen board
   *  — the mistake that flashes cleanly and leaves the board silent (#682). */
  const mismatch = useMemo(
    () => (profile && usingCatalog && selFamily ? firmwareMismatch(profile, selFamily) : null),
    [profile, usingCatalog, selFamily]
  )

  // The firmware to flash: a catalog URL (download) or a picked local path.
  // `flashUrl`, not `selVersionUrl`: the recommended build is a real choice on
  // its own, and for a board absent from the catalog it is the ONLY one (#885).
  const haveFirmware = usingCatalog ? flashUrl.length > 0 : firmwarePath.length > 0

  // A micro:bit in maintenance mode (the MAINTENANCE drive) can't be flashed with
  // MicroPython — doing so can soft-brick it — so detect it and block the flash.
  const selectedMaintenance =
    board === 'microbit' &&
    candidates.some((c) => c.board === 'microbit' && c.mountPath === mountPath && c.maintenance)

  const canFlash = useMemo(() => {
    if (flashing) return false
    // A file of the wrong KIND flashes "successfully" and bricks the boot (#685),
    // so this blocks rather than warns.
    if (fileIssue) return false
    if (!isElectron() && (isEsp || browserMicrobitViaWebUsb || browserDriveCopy)) {
      // Every browser flash path reads bytes picked via `<input type=file>`
      // directly — there's no IPC firmwarePath/esptool-availability check to
      // make, and the port/device/save-location itself is only requested
      // once Flash is clicked, since each of Web Serial/WebUSB/File System
      // Access requires a user gesture (Web W3, issue #284).
      return webFirmwareBytes !== null && webFirmwareBytes.length > 0
    }
    if (!haveFirmware) return false
    if (isEsp) {
      // ESP needs a serial port + esptool, whether the `.bin` is local or from
      // the catalog (issue #125).
      return port.length > 0 && esptool?.available === true
    }
    // A drive board (RP2040 / micro:bit) needs the boot drive to copy onto, and a
    // micro:bit must NOT be in maintenance mode.
    return mountPath.length > 0 && !selectedMaintenance
  }, [
    fileIssue,
    flashing,
    isEsp,
    browserMicrobitViaWebUsb,
    browserDriveCopy,
    webFirmwareBytes,
    haveFirmware,
    port,
    esptool,
    mountPath,
    selectedMaintenance
  ])

  /**
   * Clear the RUN — and only the run (#838).
   *
   * The log, the progress bar and the outcome banner are everything a flash
   * produced; the board, the runtime, the version, the port, the offset and the
   * erase choice are everything the user put in. Nothing here may touch the
   * second list: re-picking all of it after a flash that failed for a reason
   * they have just fixed is the whole of the complaint.
   */
  const clearRun = useCallback((): void => {
    setLog([])
    setPercent(null)
    setOutcome('idle')
  }, [])

  const resetRun = useCallback((): void => {
    clearRun()
    setFlashing(true)
  }, [clearRun])

  const handleFlash = useCallback(async (): Promise<void> => {
    resetRun()
    try {
      if (!isElectron() && isEsp) {
        // Browser (Web Serial) ESP flash: no main process to shell out to
        // esptool, so flash entirely in-renderer via esptool-js. The port is
        // requested here — inside this click handler — because
        // `navigator.serial.requestPort()` requires a user gesture (Web W3,
        // issue #284).
        if (!webFirmwareBytes) {
          throw new Error('Choose a firmware .bin file first.')
        }
        const serialPort = await requestEspPort()
        await flashEspInBrowser(serialPort, { firmware: webFirmwareBytes, offset }, handleProgress)
        return
      }
      if (browserMicrobitViaWebUsb) {
        // Browser micro:bit flash via WebUSB/DAPLink: the device is
        // requested here — inside this click handler — because
        // `navigator.usb.requestDevice()` requires a user gesture (Web W3,
        // issue #284).
        if (!webFirmwareBytes) {
          throw new Error('Choose a firmware .hex file first.')
        }
        const device = await requestMicrobitDevice()
        await flashMicrobitInBrowser(device, webFirmwareBytes, handleProgress)
        return
      }
      if (browserDriveCopy) {
        // Browser guided drive-copy flash (RP2040 always; micro:bit when
        // WebUSB isn't available or the user opted into this fallback). The
        // save-file picker is requested here for the same user-gesture
        // reason as above (Web W3, issue #284).
        if (!webFirmwareBytes) {
          throw new Error(
            `Choose a firmware ${board === 'microbit' ? '.hex' : '.uf2'} file first.`
          )
        }
        const suggestedName = firmwarePath || (board === 'microbit' ? 'firmware.hex' : 'firmware.uf2')
        await copyFirmwareToDrive(webFirmwareBytes, suggestedName, handleProgress)
        return
      }
      if (usingCatalog) {
        // Derive the flash target from the selected DOWNLOAD (its extension is
        // the mechanism; the family only supplies the ESP offset). The user may
        // have edited the offset, so prefer the field value over the default.
        const target = flashTargetForDownload(selFamily, flashUrl)
        const esp = isEspBoard(target.board)
        await window.api.firmware.downloadAndFlash({
          url: flashUrl,
          board: target.board,
          // ESP: serial port + offset; RP2040 / micro:bit: copy to the drive.
          port: esp ? port : undefined,
          offset: esp ? offset || target.offset : undefined,
          mountPath: esp ? undefined : mountPath,
          // The SAME esptool options as the local-file branch below. These were
          // missing, so the erase checkbox did nothing whenever the firmware
          // came from the catalog — the default source, and the path almost
          // everyone takes. The box was ticked, the dialog said it would erase,
          // and the board boot-looped on a partition table never cleared.
          eraseFirst: esp ? eraseFirst : undefined,
          chip: esp ? profile?.chipFamily : undefined
        })
      } else {
        await window.api.firmware.flash({
          board,
          firmwarePath,
          port: isEsp ? port : undefined,
          mountPath: isEsp ? undefined : mountPath,
          offset: isEsp ? offset : undefined,
          eraseFirst: isEsp ? eraseFirst : undefined,
          // Name the chip when the board profile knows it, so esptool doesn't
          // have to guess on a board that answers slowly (#683).
          chip: isEsp ? profile?.chipFamily : undefined
        })
      }
      // The terminal `done` progress event drives `flashing` / `outcome`.
    } catch (err) {
      setLog((prev) => [
        ...prev,
        { kind: 'error', message: err instanceof Error ? err.message : String(err) }
      ])
      setFlashing(false)
      setOutcome('error')
    }
  }, [
    resetRun,
    isEsp,
    browserMicrobitViaWebUsb,
    browserDriveCopy,
    webFirmwareBytes,
    offset,
    handleProgress,
    usingCatalog,
    selFamily,
    // Not `selVersionUrl`: the callback reads `flashUrl`, which derives from it
    // and from the recommended-build choice, so depending on both would be
    // redundant and depending on the wrong one would flash a stale URL.
    board,
    mountPath,
    firmwarePath,
    port,
    // All three are read inside; without them the callback flashes with whatever
    // they were when it was last created — so toggling Erase, or choosing the
    // recommended build, would not take effect.
    eraseFirst,
    flashUrl,
    profile?.chipFamily
  ])

  const finished = outcome === 'success' || outcome === 'error'
  /** The second way out of a finished run — back, rather than out (#838). */
  const retry = retryAction(outcome)

  return (
    <>
    <div
      className="firmware-overlay"
      role="presentation"
      onClick={() => {
        if (!flashing) onClose()
      }}
    >
      <div
        className="firmware-modal"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Flash ${runtimeLabel} firmware`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="firmware-modal__header">
          <h2 className="firmware-modal__title">Flash {runtimeLabel} firmware</h2>
          <button
            type="button"
            className="firmware-modal__close"
            aria-label="Close"
            onClick={onClose}
            disabled={flashing}
          >
            ✕
          </button>
        </header>

        <div className="firmware-modal__body">
          {/* WHICH PYTHON (#756). First, because it decides everything under it:
              which catalog is fetched, what the copy says, and — on
              CircuitPython — which board's build is pre-selected. There was no
              choice here at all before; the dialog just assumed MicroPython. */}
          <div className="firmware-field">
            <span className="firmware-field__label" id="firmware-runtime-label">
              Runtime
            </span>
            <div
              className="firmware-runtime"
              role="radiogroup"
              aria-labelledby="firmware-runtime-label"
            >
              {FIRMWARE_RUNTIMES.map((r) => {
                const on = runtime === r
                return (
                  <button
                    key={r}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    className={`firmware-runtime__tab${on ? ' firmware-runtime__tab--on' : ''}`}
                    title={`${FIRMWARE_RUNTIME_LABEL[r]} — builds from ${FIRMWARE_RUNTIME_HOST[r]}`}
                    onClick={() => handleRuntimeChange(r)}
                    disabled={flashing}
                  >
                    <svg
                      className="firmware-runtime__icon"
                      viewBox="0 0 24 24"
                      width="18"
                      height="18"
                      aria-hidden="true"
                      focusable="false"
                    >
                      <path
                        d={FIRMWARE_RUNTIME_ICON[r]}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    {/* The name STAYS. An icon-only control here would be a guess
                        about which firmware to write to someone's board. */}
                    <span className="firmware-runtime__name">{FIRMWARE_RUNTIME_LABEL[r]}</span>
                    {/* Selected is a tick, a heavier ring and bolder text as well
                        as an accent — so it survives being read in greyscale.
                        Always rendered (hidden, not removed) so choosing a
                        runtime doesn't shuffle the labels sideways. */}
                    <svg
                      className="firmware-runtime__tick"
                      viewBox="0 0 16 16"
                      width="13"
                      height="13"
                      aria-hidden="true"
                      focusable="false"
                    >
                      <path
                        d="M3 8.5 L6.5 12 L13 4.5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                )
              })}
            </div>
            <p className="firmware-hint">
              Builds come from <strong>{FIRMWARE_RUNTIME_HOST[runtime]}</strong>.
              {runtime === 'circuitpython'
                ? ' CircuitPython builds are per BOARD, not per chip — the wrong board’s build flashes without complaint and comes up with the wrong pins.'
                : ' MicroPython builds are per chip family.'}
            </p>
          </div>

          {/* Name the board FIRST (#682): it fills in the board type, the flash
              offset and the firmware family, and warns if the chosen build is for
              a different chip. Optional — "Other" leaves every field manual. */}
          <div className="firmware-field">
            {/* Detect ran into the REPL holding the port (#845). Said out loud,
                with the way out attached — knowing a port is busy is only half
                of it when the thing holding it is this same app.
                BELOW the button row, not inside it: it is a full-width status
                message about what Detect just found, not a third button. */}
            {detectConflict && (
              <div
                className="firmware-banner firmware-banner--warn firmware-conflict"
                role="status"
              >
                <p className="firmware-conflict__text">{detectConflict.reason}</p>
                <button
                  type="button"
                  className="firmware-conflict__action"
                  onClick={() => void disconnectAndDetect()}
                  disabled={disconnecting || identifying}
                  title="Close the REPL connection and detect the board again"
                >
                  {disconnecting ? 'Disconnecting…' : 'Disconnect and detect'}
                </button>
              </div>
            )}
            <label className="firmware-field__label" htmlFor="firmware-profile">
              Board
            </label>
            {/* The dropdown and the two ways of filling it in, on one row (#896).
                Naming the board is the step that fills in the board type, the
                flash offset and the firmware family — so the answer and the two
                buttons that can supply it belong together, rather than the
                buttons floating above the label they act on.
                Detect asks what is plugged in; Board Finder answers "what have I
                got" for a board that is not plugged in, or one detection could
                not name. */}
            <div className="firmware-detect-row">
              <select
                id="firmware-profile"
                className="firmware-select"
                value={profileId}
                disabled={flashing}
                onChange={(e) => handleProfileChange(e.target.value)}
              >
                <option value="">Other / set up manually…</option>
                {BOARD_PROFILES.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.label}
                  </option>
                ))}
              </select>

              {isElectron() && (
                <button
                  type="button"
                  className="firmware-detect"
                  onClick={() => void detectBoard()}
                  disabled={flashing || identifying}
                >
                  {identifying ? 'Asking the board…' : '⟳ Detect board'}
                </button>
              )}
              {/* Detect answers "what is plugged in"; this answers "what have I
                  got" for a board that is not plugged in yet, or one detection
                  could not name. Beside it, because they are the same question
                  asked two ways. */}
              <button
                type="button"
                className="firmware-detect firmware-detect--finder"
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect()
                  setFinderOrigin({ x: r.left + r.width / 2, y: r.top + r.height / 2 })
                  setFinderOpen(true)
                }}
                disabled={flashing}
                title="Browse every board MicroPython builds for"
              >
                ⌕ Board Finder
              </button>
            </div>
            {profile?.notes && <p className="firmware-hint">{profile.notes}</p>}
            {/* Advisory, not a warning: a board runs on the plain build too, it
                just may not get everything the board can do. */}
            {profile?.preferredBuild && (
              <p className="firmware-hint">
                Best build: <code>{profile.preferredBuild.name}</code>. {profile.preferredBuild.why}
                {/* Once the build has been located, say so and stop sending
                    people away: Flash fetches it. The manual link stays for the
                    case where it could not be found, but it points at a PAGE —
                    and for this board that page is headed "ESP32 / WROOM" and
                    lists the plain build first, which is the opposite of the
                    advice above it (#885). */}
                {recommendedUrl ? (
                  <> Snakie has found it and will download it when you press Flash.</>
                ) : (
                  profile.preferredBuild.url && (
                    <>
                      {' '}
                      <a
                        className="firmware-link"
                        href={profile.preferredBuild.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Find it on micropython.org
                      </a>{' '}
                      — look for <code>{profile.preferredBuild.name}</code>, not the plain build at
                      the top of that page — then choose it as a local file.
                    </>
                  )
                )}
              </p>
            )}
            {mismatch && <p className="firmware-hint firmware-hint--warn">{mismatch}</p>}
            {/* CircuitPython is matched per BOARD, so say plainly whether we know
                which board this is — and, when we don't, that we are offering
                nothing rather than a near-enough build (#756). */}
            {runtime === 'circuitpython' && activeBoardId && matchedBuild && (
              <p className="firmware-hint">
                Board ID <code>{activeBoardId}</code> — pre-selected{' '}
                <strong>{matchedBuild.model.label}</strong> from{' '}
                {FIRMWARE_RUNTIME_HOST.circuitpython}.
              </p>
            )}
            {runtime === 'circuitpython' && activeBoardId && catalog && !matchedBuild && (
              <p className="firmware-hint firmware-hint--warn">
                No CircuitPython build is published for Board ID{' '}
                <code>{activeBoardId}</code>. Nothing has been pre-selected — choose the board
                yourself below, or check circuitpython.org.
              </p>
            )}
            {runtime === 'circuitpython' && !activeBoardId && (
              <p className="firmware-hint">
                Snakie couldn’t establish this board’s CircuitPython Board ID, so nothing is
                pre-selected. Name the board above, or pick it from the list below — a build for
                the wrong board flashes without error and comes up with the wrong pins.
              </p>
            )}
            {advancedOpen && board !== 'rp2040' && board !== 'microbit' && (
              <label className="firmware-check">
                <input
                  type="checkbox"
                  checked={eraseFirst}
                  disabled={flashing}
                  onChange={(e) => setEraseFirst(e.target.checked)}
                />
                <span>
                  Erase the whole flash first — slower, but a board arriving from other firmware
                  keeps its old partition table and boot-loops without it.
                </span>
              </label>
            )}
          </div>

          {/* One switch for everything that should not be a decision (#833).
              It opens by itself when Detect could not work the board out. */}
          {isElectron() && (
            <button
              type="button"
              className="firmware-advanced-toggle"
              aria-expanded={advancedOpen}
              onClick={() => setAdvancedOpen((v) => !v)}
            >
              {advancedOpen ? '▾' : '▸'} Advanced options
            </button>
          )}
          {/* Advanced (#833): the board type follows from the board, or from
              the catalog family. Only worth showing when neither is known. */}
          {advancedOpen && (
            <div className="firmware-field">
              <label className="firmware-field__label" htmlFor="firmware-board">
                Board type
              </label>
              <div className="firmware-field__row">
                <select
                  id="firmware-board"
                  className="firmware-select"
                  value={board}
                  // In catalog mode the selected Family drives the board (issue
                  // #125), so the dropdown reflects it read-only.
                  disabled={flashing || usingCatalog}
                  onChange={(e) => handleBoardChange(e.target.value as BoardType)}
                >
                  {(Object.keys(BOARD_LABELS) as BoardType[]).map((b) => (
                    <option key={b} value={b}>
                      {BOARD_LABELS[b]}
                    </option>
                  ))}
                </select>
              </div>
              {usingCatalog && (
                <p className="firmware-hint">
                  Board type follows the catalog Family you pick below.
                </p>
              )}
              {candidates.length > 0 && (
                <p className="firmware-hint">
                  Detected: {candidates.map((c) => c.label).join('; ')}
                </p>
              )}
            </div>
          )}

          {isEsp ? (
            <>
              {isElectron() ? (
                <div className="firmware-field">
                  <label className="firmware-field__label" htmlFor="firmware-port">
                    Serial port
                  </label>
                  <select
                    id="firmware-port"
                    className="firmware-select"
                    value={port}
                    disabled={flashing}
                    onChange={(e) => setPort(e.target.value)}
                  >
                    <option value="">Select a port…</option>
                    {serialCandidates.map((c) => (
                      <option key={c.port} value={c.port}>
                        {c.label}
                      </option>
                    ))}
                    {unknownPorts.map((p) => (
                      <option key={p.path} value={p.path}>
                        {p.path} — unrecognised USB device
                      </option>
                    ))}
                    {port &&
                      !serialCandidates.some((c) => c.port === port) &&
                      !unknownPorts.some((p) => p.path === port) && (
                        <option value={port}>{port}</option>
                      )}
                  </select>
                  {/* Ask the board rather than make the user recall its spec
                      (#829). Read-only — it uploads esptool's stub and reads the
                      flash id; it writes nothing. */}
                  {identity && (
                    <p className="firmware-hint">
                      {describeIdentity(identity) ? (
                        <>
                          Found <strong>{describeIdentity(identity)}</strong>
                          {/* Say that the Board picker was CHANGED. Selecting it
                              silently would leave the user wondering why the
                              offset and the erase box moved on their own. */}
                          {profile && identity.chip && profilesForChip(identity.chip).length === 1 && (
                            <>
                              {' — '}
                              selected <strong>{profile.label}</strong> for you.
                            </>
                          )}
                          {suggestedBuild && (
                            <>
                              {' '}
                              {suggestedBuild.why}
                            </>
                          )}
                        </>
                      ) : (
                        <>
                          Could not reach the board. Hold BOOT, tap RESET, release BOOT to put it in
                          download mode, then try again.
                        </>
                      )}
                    </p>
                  )}
                  {/* More than one board uses this chip, so picking one would be
                      a guess about the flash offset. Ask instead. */}
                  {/* The recommended build, once confirmed to exist. It is
                      fetched by Flash like any other download — naming it and
                      leaving the user to find it was the clunky part (#833). */}
                  {recommendedUrl && (
                    <label className="firmware-check">
                      <input
                        type="checkbox"
                        checked={useRecommended}
                        disabled={flashing}
                        onChange={(e) => setUseRecommended(e.target.checked)}
                      />
                      <span>
                        Flash the recommended <strong>{suggestedBuild?.name}</strong> build —
                        Snakie downloads it for you. Untick to use the{' '}
                        {selVariant || 'catalog'} build shown below instead.
                      </span>
                    </label>
                  )}
                  {matchedProfiles.length > 1 && (
                    <p className="firmware-hint">
                      That chip is used by {matchedProfiles.length} boards — pick yours:{' '}
                      {matchedProfiles.map((m, i) => (
                        <span key={m.id}>
                          {i > 0 && ', '}
                          <button
                            type="button"
                            className="firmware-link"
                            onClick={() => {
                              handleProfileChange(m.id)
                              setMatchedProfiles([])
                            }}
                          >
                            {m.label}
                          </button>
                        </span>
                      ))}
                    </p>
                  )}
                </div>
              ) : (
                <p className="firmware-hint">
                  Clicking Flash will prompt you to pick the board&apos;s serial port (Web Serial —
                  Chrome or Edge only).
                </p>
              )}

              {/* Advanced (#833): the offset comes from the chip, and getting
                  it wrong writes cleanly and leaves the board dead. Not a
                  number anyone should be typing to flash a board. */}
              {advancedOpen && (
                <div className="firmware-field">
                  <label className="firmware-field__label" htmlFor="firmware-offset">
                    Flash offset
                  </label>
                  <input
                    id="firmware-offset"
                    className="firmware-input"
                    type="text"
                    value={offset}
                    disabled={flashing}
                    onChange={(e) => setOffset(e.target.value)}
                    placeholder="0x0"
                  />
                </div>
              )}

              {isElectron() && esptool && !esptool.available && (
                <p className="firmware-banner firmware-banner--warn">
                  esptool was not found on PATH. Install it with{' '}
                  <code>pip install esptool</code> (or <code>pipx install esptool</code>) to flash
                  ESP boards. Snakie does not bundle esptool.
                </p>
              )}
              {isElectron() && esptool?.available && (
                <p className="firmware-hint">
                  esptool found{esptool.version ? `: ${esptool.version}` : ''}.
                </p>
              )}
            </>
          ) : isElectron() ? (
            <div className="firmware-field">
              <label className="firmware-field__label" htmlFor="firmware-mount">
                {board === 'microbit'
                  ? 'micro:bit drive (MICROBIT)'
                  : vendorUf2
                    ? 'UF2 bootloader drive'
                    : 'RP2040 boot drive (RPI-RP2)'}
              </label>
              <div className="firmware-field__row">
                <select
                  id="firmware-mount"
                  className="firmware-select"
                  value={mountPath}
                  disabled={flashing}
                  onChange={(e) => setMountPath(e.target.value)}
                >
                  <option value="">Select a drive…</option>
                  {uf2Candidates.map((c) => (
                    <option key={c.mountPath} value={c.mountPath}>
                      {c.label}
                    </option>
                  ))}
                  {mountPath && !uf2Candidates.some((c) => c.mountPath === mountPath) && (
                    <option value={mountPath}>{mountPath}</option>
                  )}
                </select>
              </div>
              {uf2Candidates.length === 0 && (
                <p className="firmware-hint">
                  {board === 'microbit'
                    ? 'No MICROBIT drive detected. Plug the micro:bit in via USB, then press Detect.'
                    : vendorUf2
                      ? 'No UF2 bootloader drive detected. Double-tap the board’s RESET button so its bootloader volume mounts (each vendor names its own — FEATHERBOOT, QTPY_BOOT, ARDUINO…), then press Detect.'
                      : 'No RPI-RP2 drive detected. Hold BOOTSEL while plugging the board in, then press Detect.'}
                </p>
              )}
              {selectedMaintenance && (
                <p className="firmware-banner firmware-banner--warn">
                  This micro:bit is in <strong>maintenance mode</strong> (the MAINTENANCE drive),
                  which is for interface-firmware updates — {runtimeLabel} can’t be flashed here and
                  doing so can soft-brick the board. Unplug it and plug it back in{' '}
                  <strong>without holding the reset button</strong> so the MICROBIT drive appears,
                  then press Detect.
                </p>
              )}
            </div>
          ) : (
            <div className="firmware-field">
              <span className="firmware-field__label">
                {board === 'microbit' ? 'micro:bit' : 'RP2040 (Pico) boot drive'}
              </span>
              {board === 'rp2040' && (
                <p className="firmware-hint">
                  Hold the <strong>BOOTSEL</strong> button while plugging your Pico in via USB, then
                  click Flash — you&apos;ll be asked to pick the <strong>RPI-RP2</strong> drive that
                  appears (File System Access — Chrome or Edge only).
                </p>
              )}
              {board === 'microbit' && browserMicrobitViaWebUsb && (
                <>
                  <p className="firmware-hint">
                    Clicking Flash will prompt you to select your micro:bit over WebUSB (Chrome or
                    Edge only).
                  </p>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => setMicrobitUseDriveCopy(true)}
                    disabled={flashing}
                  >
                    Trouble connecting? Copy to drive instead
                  </button>
                </>
              )}
              {board === 'microbit' && !browserMicrobitViaWebUsb && (
                <>
                  <p className="firmware-hint">
                    Plug your micro:bit in via USB, then click Flash — you&apos;ll be asked to pick
                    the <strong>MICROBIT</strong> drive that appears (File System Access — Chrome or
                    Edge only).
                  </p>
                  {hasWebUSB() && (
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => setMicrobitUseDriveCopy(false)}
                      disabled={flashing}
                    >
                      Use WebUSB instead
                    </button>
                  )}
                </>
              )}
            </div>
          )}

          {/* Firmware source: download from the catalog or browse a local file.
              Available for every board — ESP (`.bin`) and RP2040 (`.uf2`) alike
              (issue #125). Outside Electron the catalog download goes through
              `window.api.firmware.fetchCatalog`/`downloadAndFlash`, which have
              no browser implementation yet (Web W3, issue #284) — only Local
              file is offered there. */}
          {/* Advanced (#833): the catalog is the default and covers almost
              everyone. Choosing a local file assumes you have already been
              somewhere else and come back with the right build. */}
          {isElectron() && advancedOpen && (
            <div className="firmware-field">
              <span className="firmware-field__label">Firmware source</span>
              <div className="firmware-source-toggle" role="radiogroup" aria-label="Firmware source">
                <button
                  type="button"
                  role="radio"
                  aria-checked={source === 'catalog'}
                  className={`firmware-source-tab ${source === 'catalog' ? 'is-active' : ''}`}
                  onClick={() => setSource('catalog')}
                  disabled={flashing}
                >
                  Download from {FIRMWARE_RUNTIME_HOST[runtime]}
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={source === 'local'}
                  className={`firmware-source-tab ${source === 'local' ? 'is-active' : ''}`}
                  onClick={() => setSource('local')}
                  disabled={flashing}
                >
                  Local file
                </button>
              </div>
            </div>
          )}

          {usingCatalog ? (
            <div className="firmware-field">
              <div className="firmware-field__row">
                <span className="firmware-field__label">
                  {FIRMWARE_RUNTIME_HOST[runtime]} firmware
                </span>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => void loadCatalog()}
                  disabled={flashing || catalogLoading}
                  title="Re-fetch the firmware catalog"
                >
                  ⟳ Refresh
                </button>
              </div>

              {catalogLoading && <p className="firmware-hint">Fetching firmware catalog…</p>}
              {catalogError && (
                <p className="firmware-banner firmware-banner--warn">
                  Could not load the firmware catalog: {catalogError} You can still use{' '}
                  <strong>Local file</strong>.
                </p>
              )}

              {catalog && !catalogLoading && (
                <>
                  {/* Two columns (#896). Family narrows Model, so they are one
                      decision made in two steps — side by side they read as
                      that, and stacked they read as two unrelated questions
                      with the dialog growing a row taller for no reason. */}
                  <div className="firmware-cols">
                    <div className="firmware-col">
                      <label className="firmware-field__label" htmlFor="firmware-cat-family">
                        Family
                      </label>
                      <select
                        id="firmware-cat-family"
                        className="firmware-select"
                        value={selFamily}
                        disabled={flashing}
                        onChange={(e) => setSelFamily(e.target.value)}
                      >
                        <option value="">Select a family…</option>
                        {families.map((f) => (
                          <option key={f.family} value={f.family}>
                            {f.family}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="firmware-col">
                      <label className="firmware-field__label" htmlFor="firmware-cat-model">
                        Model
                      </label>
                      <select
                        id="firmware-cat-model"
                        className="firmware-select"
                        value={selModel}
                        disabled={flashing || !family}
                        onChange={(e) => setSelModel(e.target.value)}
                      >
                        <option value="">Select a model…</option>
                        {models.map((m) => (
                          <option key={`${m.vendor}|${m.model}`} value={`${m.vendor}|${m.model}`}>
                            {m.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {model && (
                    <>
                      <label className="firmware-field__label" htmlFor="firmware-cat-variant">
                        Variant
                      </label>
                      <select
                        id="firmware-cat-variant"
                        className="firmware-select"
                        value={selVariant}
                        disabled={flashing}
                        onChange={(e) => setSelVariant(e.target.value)}
                      >
                        <option value="">Select a variant…</option>
                        {variants.map((v) => (
                          <option key={v.title} value={v.title}>
                            {v.title}
                            {v.popular ? ' ★' : ''}
                          </option>
                        ))}
                      </select>

                      <label className="firmware-field__label" htmlFor="firmware-cat-version">
                        Version
                      </label>
                      <select
                        id="firmware-cat-version"
                        className="firmware-select"
                        value={selVersionUrl}
                        disabled={flashing || !variant}
                        onChange={(e) => setSelVersionUrl(e.target.value)}
                      >
                        <option value="">Select a version…</option>
                        {versions.map((ver) => (
                          <option key={ver.url} value={ver.url}>
                            {ver.version}
                          </option>
                        ))}
                      </select>
                    </>
                  )}
                </>
              )}
            </div>
          ) : (
            <div className="firmware-field">
              <label className="firmware-field__label">Firmware file</label>
              <div className="firmware-field__row">
                <input
                  className="firmware-input firmware-input--grow"
                  type="text"
                  readOnly
                  value={firmwarePath}
                  placeholder={
                    isEsp
                      ? 'Choose a .bin file…'
                      : board === 'microbit'
                        ? 'Choose a .hex file…'
                        : 'Choose a .uf2 file…'
                  }
                />
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => void handlePickFile()}
                  disabled={flashing}
                >
                  Browse…
                </button>
              </div>
              {/* Hidden browser file input backing "Browse…" outside Electron
                  (Web W3, issue #284) — there's no filesystem-path IPC to call. */}
              <input
                ref={webFileInputRef}
                type="file"
                accept={isEsp ? '.bin' : board === 'microbit' ? '.hex' : '.uf2'}
                style={{ display: 'none' }}
                onChange={(e) => void handleWebFileChange(e)}
              />
              {/* Wrong KIND of file. Blocks the flash rather than warning: this one
                  reports success at every step and leaves the board dead (#685). */}
              {fileIssue && <p className="firmware-hint firmware-hint--warn">{fileIssue}</p>}
            </div>
          )}

          {percent !== null && (
            <div className="firmware-field">
              <div
                className="firmware-progress"
                role="progressbar"
                aria-label="Flash progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
              >
                <div className="firmware-progress__bar" style={{ width: `${percent}%` }} />
              </div>
              <p className="firmware-hint firmware-progress__label">{percent}% complete</p>
            </div>
          )}

          {(log.length > 0 || flashing) && (
            <div className="firmware-log__bar">
              <span className="firmware-log__title">Output</span>
              <div className="firmware-log__actions">
                <label
                  className="firmware-log__check"
                  title="Follow the newest line. Turn this off to scroll back and read while the flash is still running."
                >
                  <input
                    type="checkbox"
                    checked={autoScroll}
                    onChange={(e) => setAutoScroll(e.target.checked)}
                  />
                  <span>Autoscroll</span>
                </label>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => void copyLog()}
                  disabled={log.length === 0}
                  title="Copy the whole log, including the parts scrolled out of view"
                >
                  {copied ? 'Copied' : 'Copy log'}
                </button>
              </div>
            </div>
          )}
          {(log.length > 0 || flashing) && (
            <div
              className={`firmware-log firmware-log--${outcome}`}
              ref={logRef}
              role="log"
              aria-live="polite"
            >
              {log.map((line, i) => (
                <div
                  key={i}
                  className={`firmware-log__line firmware-log__line--${line.kind}`}
                >
                  {line.message}
                </div>
              ))}
              {flashing && <div className="firmware-log__line">Flashing…</div>}
            </div>
          )}

          {/* Persistent live region so the flash outcome is announced (the log
              block above is live, but the summary banner wasn't) — a11y, #188. */}
          <div role="status" aria-live="polite">
            {outcome === 'success' && (
              <p className="firmware-banner firmware-banner--success">
                Firmware flashed successfully.
              </p>
            )}
            {outcome === 'error' && (
              <p className="firmware-banner firmware-banner--error">
                Flashing failed. Check the log above.
              </p>
            )}
          </div>
        </div>

        <footer className="firmware-modal__footer">
          {finished ? (
            <>
              {/* Done used to be the only way out of a finished run, and it
                  closed the dialog — losing the board, the version and every
                  advanced option chosen to get here, right at the moment a
                  failed flash makes you want to change one of them (#838). */}
              {retry && (
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={clearRun}
                  title={retry.title}
                >
                  {retry.label}
                </button>
              )}
              <button
                type="button"
                className="btn btn--primary btn--lg"
                onClick={onClose}
                autoFocus
              >
                Done
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={onClose}
                disabled={flashing}
              >
                Close
              </button>
              <button
                type="button"
                className="btn btn--primary btn--lg"
                onClick={() => void handleFlash()}
                disabled={!canFlash}
                title={
                  usingCatalog && !selVersionUrl
                    ? 'Choose a firmware version to download'
                    : !usingCatalog && !firmwarePath
                      ? 'Choose a firmware file first'
                      : isEsp && !port
                        ? 'Select a serial port'
                        : isEsp && esptool?.available !== true
                          ? 'esptool is required to flash ESP boards'
                          : !isEsp && !mountPath
                            ? 'Select the RP2040 boot drive'
                            : 'Flash the firmware to the device'
                }
              >
                {flashing ? 'Flashing…' : usingCatalog ? 'Download & Flash' : 'Flash'}
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
      {/* A SIBLING of the overlay, not a child: a full-screen gallery nested in
          the modal's backdrop would be clipped by it and would inherit its
          click-anywhere-to-dismiss. */}
      {finderOpen && (
        <BoardFinder
          origin={finderOrigin}
          closing={finderClosing}
          onClosed={dropFinder}
          onClose={closeFinder}
        />
      )}
    </>
  )
}
