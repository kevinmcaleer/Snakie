import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  BoardCandidate,
  BoardType,
  EsptoolInfo,
  FirmwareCatalog,
  FlashProgress
} from '../../../preload/index.d'
import './FirmwareFlasher.css'

interface FirmwareFlasherProps {
  /** Close the modal (ignored while a flash is in progress). */
  onClose: () => void
}

const BOARD_LABELS: Record<BoardType, string> = {
  esp32: 'ESP32 (esptool)',
  esp8266: 'ESP8266 (esptool)',
  rp2040: 'RP2040 / Pico (UF2)'
}

/** Default ESP offsets shown in the UI; user can override per board. */
const DEFAULT_OFFSET: Record<BoardType, string> = {
  esp32: '0x1000',
  esp8266: '0x0',
  rp2040: ''
}

/** Where the `.uf2` to flash comes from. */
type Source = 'local' | 'catalog'

/**
 * FIRMWARE FLASHER MODAL (issues #14, #64).
 *
 * Lets the user flash MicroPython firmware to a device without leaving Snakie:
 *  - auto-detects board candidates (serial VID/PID for ESP, RPI-RP2 UF2 drive),
 *  - for UF2 boards, picks the firmware EITHER by browsing a local `.uf2`
 *    file OR by downloading one from MicroPython.org via Thonny's curated
 *    catalog (Family → Model → Variant → Version cascade) — issue #64,
 *  - for ESP boards, picks the `.bin` file and flashes via esptool,
 *  - streams a live log + a % progress bar (download then copy), with a Done
 *    button once the flash finishes (success or failure).
 *
 * All heavy lifting happens in the main process via `window.api.firmware`; this
 * component is purely presentational state + orchestration.
 */
export function FirmwareFlasher({ onClose }: FirmwareFlasherProps): JSX.Element {
  const [candidates, setCandidates] = useState<BoardCandidate[]>([])
  const [board, setBoard] = useState<BoardType>('esp32')
  const [port, setPort] = useState<string>('')
  const [mountPath, setMountPath] = useState<string>('')
  const [offset, setOffset] = useState<string>(DEFAULT_OFFSET.esp32)
  const [firmwarePath, setFirmwarePath] = useState<string>('')
  const [esptool, setEsptool] = useState<EsptoolInfo | null>(null)
  const [log, setLog] = useState<FlashProgress[]>([])
  const [percent, setPercent] = useState<number | null>(null)
  const [flashing, setFlashing] = useState(false)
  const [outcome, setOutcome] = useState<'idle' | 'success' | 'error'>('idle')
  const logRef = useRef<HTMLDivElement>(null)

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

  // Subscribe to streamed progress for the lifetime of the modal.
  useEffect(() => {
    const unsubscribe = window.api.firmware.onProgress((p) => {
      setLog((prev) => [...prev, p])
      if (typeof p.percent === 'number') setPercent(p.percent)
      if (p.kind === 'done') {
        setFlashing(false)
        setOutcome(p.ok ? 'success' : 'error')
      }
    })
    return unsubscribe
  }, [])

  // Auto-scroll the log to the latest line.
  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [log])

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
        if (first.port) setPort(first.port)
        if (first.mountPath) setMountPath(first.mountPath)
      }
    } catch {
      // Detection is best-effort; leave manual selection available.
    }
  }, [])

  useEffect(() => {
    void refreshDetection()
  }, [refreshDetection])

  const handleBoardChange = useCallback((next: BoardType): void => {
    setBoard(next)
    setOffset(DEFAULT_OFFSET[next])
    // The catalog source only applies to UF2 boards; snap ESP back to local.
    if (next === 'esp32' || next === 'esp8266') setSource('local')
  }, [])

  const handlePickFile = useCallback(async (): Promise<void> => {
    try {
      const picked = await window.api.firmware.pickFirmwareFile()
      if (picked) setFirmwarePath(picked)
    } catch {
      // Cancelled / unavailable — keep the current selection.
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

  // When the user switches to the catalog source for a UF2 board, fetch it once
  // and pre-select a sensible family (rp2 for RP2040) + the detected boot drive.
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

  // Pre-select Family (rp2 if present, else first) once the catalog arrives.
  useEffect(() => {
    if (families.length === 0) return
    if (selFamily && families.some((f) => f.family === selFamily)) return
    const preferred = families.find((f) => f.family === 'rp2') ?? families[0]
    setSelFamily(preferred.family)
  }, [families, selFamily])

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

  const serialCandidates = candidates.filter((c) => c.source === 'serial')
  const uf2Candidates = candidates.filter((c) => c.source === 'uf2-drive')

  const usingCatalog = !isEsp && source === 'catalog'

  const canFlash = useMemo(() => {
    if (flashing) return false
    if (isEsp) {
      return port.length > 0 && esptool?.available === true && firmwarePath.length > 0
    }
    // UF2 boards: need the boot drive plus either a local file or a chosen URL.
    if (mountPath.length === 0) return false
    return usingCatalog ? selVersionUrl.length > 0 : firmwarePath.length > 0
  }, [flashing, isEsp, port, esptool, firmwarePath, mountPath, usingCatalog, selVersionUrl])

  const resetRun = useCallback((): void => {
    setLog([])
    setPercent(null)
    setOutcome('idle')
    setFlashing(true)
  }, [])

  const handleFlash = useCallback(async (): Promise<void> => {
    resetRun()
    try {
      if (usingCatalog) {
        await window.api.firmware.downloadAndFlash({
          url: selVersionUrl,
          board,
          mountPath
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
  }, [resetRun, usingCatalog, selVersionUrl, board, mountPath, firmwarePath, isEsp, port, offset])

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
                disabled={flashing}
                onChange={(e) => handleBoardChange(e.target.value as BoardType)}
              >
                {(Object.keys(BOARD_LABELS) as BoardType[]).map((b) => (
                  <option key={b} value={b}>
                    {BOARD_LABELS[b]}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => void refreshDetection()}
                disabled={flashing}
                title="Re-scan for connected boards"
              >
                ⟳ Detect
              </button>
            </div>
            {candidates.length > 0 && (
              <p className="firmware-hint">
                Detected: {candidates.map((c) => c.label).join('; ')}
              </p>
            )}
          </div>

          {isEsp ? (
            <>
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

              {esptool && !esptool.available && (
                <p className="firmware-banner firmware-banner--warn">
                  esptool was not found on PATH. Install it with{' '}
                  <code>pip install esptool</code> (or <code>pipx install esptool</code>) to flash
                  ESP boards. Snakie does not bundle esptool.
                </p>
              )}
              {esptool?.available && (
                <p className="firmware-hint">
                  esptool found{esptool.version ? `: ${esptool.version}` : ''}.
                </p>
              )}
            </>
          ) : (
            <div className="firmware-field">
              <label className="firmware-field__label" htmlFor="firmware-mount">
                RP2040 boot drive (RPI-RP2)
              </label>
              <div className="firmware-field__row">
                <select
                  id="firmware-mount"
                  className="firmware-select"
                  value={mountPath}
                  disabled={flashing}
                  onChange={(e) => setMountPath(e.target.value)}
                >
                  <option value="">Select a boot drive…</option>
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
                  No RPI-RP2 drive detected. Hold BOOTSEL while plugging the board in, then press
                  Detect.
                </p>
              )}
            </div>
          )}

          {/* Firmware source: local file (always) or, for UF2 boards, the catalog. */}
          {!isEsp && (
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
                  placeholder={isEsp ? 'Choose a .bin file…' : 'Choose a .uf2 file…'}
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
            </div>
          )}

          {percent !== null && (
            <div className="firmware-field">
              <div
                className="firmware-progress"
                role="progressbar"
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

          {outcome === 'success' && (
            <p className="firmware-banner firmware-banner--success">Firmware flashed successfully.</p>
          )}
          {outcome === 'error' && (
            <p className="firmware-banner firmware-banner--error">
              Flashing failed. Check the log above.
            </p>
          )}
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
                  isEsp && !port
                    ? 'Select a serial port'
                    : isEsp && esptool?.available !== true
                      ? 'esptool is required to flash ESP boards'
                      : isEsp && !firmwarePath
                        ? 'Choose a firmware file first'
                        : !isEsp && !mountPath
                          ? 'Select the RP2040 boot drive'
                          : usingCatalog && !selVersionUrl
                            ? 'Choose a firmware version to download'
                            : !usingCatalog && !firmwarePath
                              ? 'Choose a firmware file first'
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
