import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  BoardCandidate,
  BoardType,
  EsptoolInfo,
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

/**
 * FIRMWARE FLASHER MODAL (issue #14).
 *
 * Lets the user flash MicroPython firmware to a device without leaving Snakie:
 *  - auto-detects board candidates (serial VID/PID for ESP, RPI-RP2 UF2 drive),
 *  - picks the firmware file (`.bin` for ESP, `.uf2` for RP2040),
 *  - flashes via esptool (ESP) or a UF2 copy (RP2040), and
 *  - streams a live log with clear success / error states.
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
  const [flashing, setFlashing] = useState(false)
  const [outcome, setOutcome] = useState<'idle' | 'success' | 'error'>('idle')
  const logRef = useRef<HTMLDivElement>(null)

  const isEsp = board === 'esp32' || board === 'esp8266'

  // Subscribe to streamed progress for the lifetime of the modal.
  useEffect(() => {
    const unsubscribe = window.api.firmware.onProgress((p) => {
      setLog((prev) => [...prev, p])
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
  }, [])

  const handlePickFile = useCallback(async (): Promise<void> => {
    try {
      const picked = await window.api.firmware.pickFirmwareFile()
      if (picked) setFirmwarePath(picked)
    } catch {
      // Cancelled / unavailable — keep the current selection.
    }
  }, [])

  const serialCandidates = candidates.filter((c) => c.source === 'serial')
  const uf2Candidates = candidates.filter((c) => c.source === 'uf2-drive')

  const canFlash =
    !flashing &&
    firmwarePath.length > 0 &&
    (isEsp ? port.length > 0 : mountPath.length > 0) &&
    (!isEsp || esptool?.available === true)

  const handleFlash = useCallback(async (): Promise<void> => {
    setLog([])
    setOutcome('idle')
    setFlashing(true)
    try {
      await window.api.firmware.flash({
        board,
        firmwarePath,
        port: isEsp ? port : undefined,
        mountPath: isEsp ? undefined : mountPath,
        offset: isEsp ? offset : undefined
      })
      // The terminal `done` progress event drives `flashing` / `outcome`.
    } catch (err) {
      setLog((prev) => [
        ...prev,
        { kind: 'error', message: err instanceof Error ? err.message : String(err) }
      ])
      setFlashing(false)
      setOutcome('error')
    }
  }, [board, firmwarePath, isEsp, port, mountPath, offset])

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
              !firmwarePath
                ? 'Choose a firmware file first'
                : isEsp && !port
                  ? 'Select a serial port'
                  : !isEsp && !mountPath
                    ? 'Select the RP2040 boot drive'
                    : isEsp && esptool?.available !== true
                      ? 'esptool is required to flash ESP boards'
                      : 'Flash the firmware to the device'
            }
          >
            {flashing ? 'Flashing…' : 'Flash'}
          </button>
        </footer>
      </div>
    </div>
  )
}
