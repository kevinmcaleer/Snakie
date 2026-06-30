/**
 * Shared types for the serial device layer.
 *
 * These types are intentionally plain (no class instances, no Buffers) so they
 * serialize cleanly across the Electron IPC boundary and can be re-used by the
 * preload typings and the renderer.
 */

/** A serial port discovered by enumeration. */
export interface PortInfo {
  /** OS path / device name, e.g. `/dev/ttyACM0` or `COM3`. */
  path: string
  manufacturer?: string
  serialNumber?: string
  /** USB vendor id (hex string as reported by the OS, e.g. `2e8a`). */
  vendorId?: string
  /** USB product id (hex string). */
  productId?: string
  /** Human-friendly label, when the OS provides one. */
  friendlyName?: string
}

/** Options for opening a connection. */
export interface ConnectOptions {
  /** Baud rate. Defaults to 115200 (the MicroPython convention). */
  baudRate?: number
}

/** Connection lifecycle states. */
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error'

/** Current status of the device connection, safe to send over IPC. */
export interface DeviceStatus {
  state: ConnectionState
  /** Path of the currently/last targeted port, if any. */
  path?: string
  baudRate?: number
  /** Populated when `state === 'error'`. */
  error?: string
}

/** Result of running code in the raw REPL. */
export interface ExecResult {
  /** Decoded stdout captured between the raw-REPL output markers. */
  stdout: string
  /** Decoded stderr / traceback captured after the first `\x04` marker. */
  stderr: string
}

/** A single entry returned by {@link MicroPythonDevice.listDir}. */
export interface DirEntry {
  name: string
  /** True when the entry is a directory. */
  isDir: boolean
  /** File size in bytes (0 for directories). */
  size: number
}

/** Result of {@link MicroPythonDevice.stat} mirroring `os.stat` essentials. */
export interface StatResult {
  isDir: boolean
  size: number
  /** st_mtime (seconds since epoch) as reported by the device, if available. */
  mtime?: number
}

/**
 * Generic IPC result wrapper. The IPC handlers return one of these so that
 * errors cross the boundary as plain serializable data rather than relying on
 * Electron's lossy error re-throwing.
 */
export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: string }

/**
 * The common device surface the IPC layer talks to. Both the real
 * `MicroPythonDevice` (serial) and the `SimulatedDevice` (offline mode, #135)
 * implement this, so `device/ipc.ts` can route to whichever backend is active
 * without caring which is which. The `data` / `status` events carry the same
 * payloads from both backends.
 */
export interface SnakieDevice {
  connect(path: string, options?: ConnectOptions): Promise<void>
  disconnect(): Promise<void>
  getStatus(): DeviceStatus
  isConnected(): boolean
  exec(code: string, timeoutMs?: number): Promise<ExecResult>
  eval(code: string, timeoutMs?: number): Promise<string>
  sendData(data: string): Promise<void>
  sendControl(target: string, payload?: string): Promise<void>
  interrupt(): Promise<void>
  softReset(): Promise<void>
  listDir(path?: string): Promise<DirEntry[]>
  readFile(path: string): Promise<string>
  writeFile(path: string, contents: string | Buffer): Promise<void>
  remove(path: string): Promise<void>
  mkdir(path: string): Promise<void>
  rename(from: string, to: string): Promise<void>
  stat(path: string): Promise<StatResult>
  dispose(): Promise<void>
  on(event: 'data', listener: (chunk: Buffer) => void): this
  on(event: 'status', listener: (status: DeviceStatus) => void): this
}
