import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import type {
  BoardCandidate,
  BoardType,
  EsptoolInfo,
  FirmwareCatalog,
  FlashProgress
} from '../../../preload/index.d'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { isElectron } from '../lib/platform'
import { flashEspInBrowser, requestEspPort } from '../lib/webFirmware/espFlash'
import './FirmwareFlasher.css'

interface FirmwareFlasherProps {
  /** Close the modal (ignored while a flash is in progress). */
  onClose: () => void
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
 * Map a catalog `family` to the flash `{ board, offset }` for a catalog flash
 * (issue #125). MUST match `flashTargetForFamily` in
 * `src/main/firmware/catalog.ts` (the canonical, unit-tested copy); replicated
 * here — rather than imported from `src/main` — so the renderer bundle stays
 * free of main-only modules, mirroring `sanitiseBoardId`.
 */
function flashTargetForFamily(family: string): { board: BoardType; offset?: string } {
  const fam = family.trim().toLowerCase()
  if (fam.startsWith('rp2')) return { board: 'rp2040' }
  if (fam.startsWith('nrf') || fam === 'microbit') return { board: 'microbit' }
  if (fam === 'esp8266') return { board: 'esp8266', offset: '0x0' }
  if (fam.startsWith('esp')) return { board: 'esp32', offset: fam === 'esp32' ? '0x1000' : '0x0' }
  return { board: 'rp2040' }
}

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
 * #284) there's no process to shell out to `esptool`, so ESP32/ESP8266
 * flashing instead runs entirely in the renderer over the Web Serial API via
 * `esptool-js` (see `lib/webFirmware/espFlash.ts`); the board picker is
 * narrowed to ESP boards only and the firmware-catalog download is hidden
 * (RP2040/micro:bit browser flashing and a browser-native catalog fetch are
 * follow-up work). `isElectron()` from `lib/platform` decides which path a
 * given render takes.
 */
export function FirmwareFlasher({ onClose }: FirmwareFlasherProps): JSX.Element {
  const [candidates, setCandidates] = useState<BoardCandidate[]>([])
  const [board, setBoard] = useState<BoardType>('esp32')
  const [port, setPort] = useState<string>('')
  const [mountPath, setMountPath] = useState<string>('')
  const [offset, setOffset] = useState<string>(DEFAULT_OFFSET.esp32)
  const [firmwarePath, setFirmwarePath] = useState<string>('')
  // The picked firmware's raw bytes, for the browser (Web Serial) flash path,
  // which has no filesystem path to hand to esptool — only a `File` (Web W3).
  const [webFirmwareBytes, setWebFirmwareBytes] = useState<Uint8Array | null>(null)
  const webFileInputRef = useRef<HTMLInputElement>(null)
  const [esptool, setEsptool] = useState<EsptoolInfo | null>(null)
  // Generation of a detected micro:bit (v1/v2), to pre-select the right firmware.
  const [detectedMicrobit, setDetectedMicrobit] = useState<'v1' | 'v2' | undefined>(undefined)
  const [log, setLog] = useState<FlashProgress[]>([])
  const [percent, setPercent] = useState<number | null>(null)
  const [flashing, setFlashing] = useState(false)
  const [outcome, setOutcome] = useState<'idle' | 'success' | 'error'>('idle')
  const logRef = useRef<HTMLDivElement>(null)
  // Move focus into the dialog on open, trap Tab, and restore it on close.
  const dialogRef = useFocusTrap<HTMLDivElement>()

  // --- Catalog (download-from-MicroPython.org) state (issue #64) ---
  const [source, setSource] = useState<Source>('local')
  const [catalog, setCatalog] = useState<FirmwareCatalog | null>(null)
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [selFamily, setSelFamily] = useState<string>('')
  const [selModel, setSelModel] = useState<string>('')
  const [selVariant, setSelVariant] = useState<string>('')
  const [selVersionUrl, setSelVersionUrl] = useState<string>('')

  const isEsp = board === 'esp32' || board === 'esp8266'

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

  // Auto-scroll the log to the latest line.
  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [log])

  // Escape closes the dialog (consistent with the other modals), but never
  // mid-flash — interrupting a flash could leave the device half-written.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !flashing) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [flashing, onClose])

  const refreshDetection = useCallback(async (): Promise<void> => {
    try {
      const [found, tool] = await Promise.all([
        window.api.firmware.detectBoards(),
        window.api.firmware.checkEsptool()
      ])
      setCandidates(found)
      setEsptool(tool)
      // Adopt the first detected candidate as a sensible default.
      const first = found[0]
      if (first) {
        setBoard(first.board)
        setOffset(DEFAULT_OFFSET[first.board])
        // port / mountPath / detectedMicrobit are derived from the selected board
        // by the effect below, so a board switch can't keep a stale target.
      }
    } catch {
      // Detection is best-effort; leave manual selection available.
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

  const handleBoardChange = useCallback((next: BoardType): void => {
    setBoard(next)
    setOffset(DEFAULT_OFFSET[next])
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
      const picked = await window.api.firmware.pickFirmwareFile()
      if (picked) setFirmwarePath(picked)
    } catch {
      // Cancelled / unavailable — keep the current selection.
    }
  }, [])

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
      const fetched = await window.api.firmware.fetchCatalog()
      setCatalog(fetched)
    } catch (err) {
      setCatalog(null)
      setCatalogError(err instanceof Error ? err.message : String(err))
    } finally {
      setCatalogLoading(false)
    }
  }, [])

  // When the user switches to the catalog source (any board), fetch it once.
  useEffect(() => {
    if (source !== 'catalog') return
    if (!catalog && !catalogLoading && !catalogError) void loadCatalog()
  }, [source, catalog, catalogLoading, catalogError, loadCatalog])

  const families = useMemo(() => catalog?.families ?? [], [catalog])
  const family = useMemo(
    () => families.find((f) => f.family === selFamily),
    [families, selFamily]
  )
  const models = useMemo(() => family?.models ?? [], [family])
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

  // Pre-select a sensible Family once the catalog arrives: prefer one whose
  // flash target matches the currently selected board (so an ESP user lands on
  // an ESP family), then `rp2`, then the first family. For a detected micro:bit,
  // prefer the family matching its generation (nrf52 for v2, nrf51 for v1).
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

  // Reset downstream selections whenever the upstream selection changes.
  useEffect(() => {
    setSelModel('')
    setSelVariant('')
    setSelVersionUrl('')
  }, [selFamily])

  // Auto-pick the sole variant + newest version once a Model is chosen.
  useEffect(() => {
    if (variants.length === 1) setSelVariant(variants[0].title)
  }, [variants])

  useEffect(() => {
    if (versions.length > 0) setSelVersionUrl(versions[0].url)
    else setSelVersionUrl('')
  }, [versions])

  // For a CATALOG flash the selected family is authoritative: sync the Board
  // type to its flash target and pre-fill the offset (still user-editable in the
  // Flash offset field) per chip (issue #125). This surfaces the right inputs
  // (port/offset for ESP, boot drive for RP2040) automatically.
  useEffect(() => {
    if (source !== 'catalog' || !selFamily) return
    const target = flashTargetForFamily(selFamily)
    setBoard(target.board)
    setOffset(target.offset ?? DEFAULT_OFFSET[target.board])
  }, [source, selFamily])

  const serialCandidates = candidates.filter((c) => c.source === 'serial')
  // Drive candidates relevant to the selected board (RP2040 vs micro:bit drives).
  const uf2Candidates = candidates.filter((c) => c.source === 'uf2-drive' && c.board === board)

  const usingCatalog = source === 'catalog'

  // The firmware to flash: a catalog URL (download) or a picked local path.
  const haveFirmware = usingCatalog ? selVersionUrl.length > 0 : firmwarePath.length > 0

  // A micro:bit in maintenance mode (the MAINTENANCE drive) can't be flashed with
  // MicroPython — doing so can soft-brick it — so detect it and block the flash.
  const selectedMaintenance =
    board === 'microbit' &&
    candidates.some((c) => c.board === 'microbit' && c.mountPath === mountPath && c.maintenance)

  const canFlash = useMemo(() => {
    if (flashing) return false
    if (!isElectron() && isEsp) {
      // Browser (Web Serial) flashing reads bytes picked via `<input type=file>`
      // directly — there's no IPC firmwarePath/esptool-availability check to
      // make, and the serial port itself is only requested once Flash is
      // clicked (Web W3, issue #284).
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
  }, [flashing, isEsp, webFirmwareBytes, haveFirmware, port, esptool, mountPath, selectedMaintenance])

  const resetRun = useCallback((): void => {
    setLog([])
    setPercent(null)
    setOutcome('idle')
    setFlashing(true)
  }, [])

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
      if (usingCatalog) {
        // Derive the flash target from the selected family (authoritative for a
        // catalog flash); the user may have edited the offset, so prefer the
        // field value over the family default (issue #125).
        const target = flashTargetForFamily(selFamily)
        const esp = isEspBoard(target.board)
        await window.api.firmware.downloadAndFlash({
          url: selVersionUrl,
          board: target.board,
          // ESP: serial port + offset; RP2040 / micro:bit: copy to the drive.
          port: esp ? port : undefined,
          offset: esp ? offset || target.offset : undefined,
          mountPath: esp ? undefined : mountPath
        })
      } else {
        await window.api.firmware.flash({
          board,
          firmwarePath,
          port: isEsp ? port : undefined,
          mountPath: isEsp ? undefined : mountPath,
          offset: isEsp ? offset : undefined
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
    webFirmwareBytes,
    offset,
    handleProgress,
    usingCatalog,
    selFamily,
    selVersionUrl,
    board,
    mountPath,
    firmwarePath,
    port
  ])

  const finished = outcome === 'success' || outcome === 'error'

  return (
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
        aria-label="Flash MicroPython firmware"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="firmware-modal__header">
          <h2 className="firmware-modal__title">Flash MicroPython firmware</h2>
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
                {(Object.keys(BOARD_LABELS) as BoardType[])
                  // Outside Electron, only ESP32/ESP8266 flash today (Web
                  // Serial via esptool-js) — RP2040/micro:bit browser flashing
                  // is follow-up work (Web W3, issue #284).
                  .filter((b) => isElectron() || isEspBoard(b))
                  .map((b) => (
                    <option key={b} value={b}>
                      {BOARD_LABELS[b]}
                    </option>
                  ))}
              </select>
              {isElectron() && (
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => void refreshDetection()}
                  disabled={flashing}
                  title="Re-scan for connected boards"
                >
                  ⟳ Detect
                </button>
              )}
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
            {!isElectron() && (
              <p className="firmware-hint">
                micro:bit and Pico flashing in the browser are coming soon — use the desktop app for
                those boards today.
              </p>
            )}
          </div>

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
                    {port && !serialCandidates.some((c) => c.port === port) && (
                      <option value={port}>{port}</option>
                    )}
                  </select>
                </div>
              ) : (
                <p className="firmware-hint">
                  Clicking Flash will prompt you to pick the board&apos;s serial port (Web Serial —
                  Chrome or Edge only).
                </p>
              )}

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
                  placeholder="0x1000"
                />
              </div>

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
          ) : (

            <div className="firmware-field">
              <label className="firmware-field__label" htmlFor="firmware-mount">
                {board === 'microbit' ? 'micro:bit drive (MICROBIT)' : 'RP2040 boot drive (RPI-RP2)'}
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
                    : 'No RPI-RP2 drive detected. Hold BOOTSEL while plugging the board in, then press Detect.'}
                </p>
              )}
              {selectedMaintenance && (
                <p className="firmware-banner firmware-banner--warn">
                  This micro:bit is in <strong>maintenance mode</strong> (the MAINTENANCE drive),
                  which is for interface-firmware updates — MicroPython can’t be flashed here and
                  doing so can soft-brick the board. Unplug it and plug it back in{' '}
                  <strong>without holding the reset button</strong> so the MICROBIT drive appears,
                  then press Detect.
                </p>
              )}
            </div>
          )}

          {/* Firmware source: download from the catalog or browse a local file.
              Available for every board — ESP (`.bin`) and RP2040 (`.uf2`) alike
              (issue #125). Outside Electron the catalog download goes through
              `window.api.firmware.fetchCatalog`/`downloadAndFlash`, which have
              no browser implementation yet (Web W3, issue #284) — only Local
              file is offered there. */}
          {isElectron() && (
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
                  Download from MicroPython.org
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
                <span className="firmware-field__label">MicroPython.org firmware</span>
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
            <button
              type="button"
              className="btn btn--primary btn--lg"
              onClick={onClose}
              autoFocus
            >
              Done
            </button>
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
  )
}
