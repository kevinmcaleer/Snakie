/**
 * Main-thread `device` Api implementation for the web build (epic #267 Phase
 * W1) — drives the {@link WebSimulatedDevice} that lives in a Web Worker
 * (`micropython.worker.ts`) over `workerProtocol`'s RPC/event messages.
 * Matches `src/preload/index.ts`'s `device` object shape exactly so
 * `createWebApi()` can drop this in as a straight replacement.
 *
 * The worker transport is injected (`WorkerLike`) so tests can supply an
 * in-memory fake instead of spinning up a real `Worker` (not available in
 * vitest's default Node environment).
 */
import type { DeviceStatus, DirEntry, ExecResult, PortInfo, StatResult } from '../../../../main/device/types'
import { DF_SNIPPET, parseDfOutput, type DfResult } from '../../../../shared/device/df'
import { VIRTUAL_PORT_LABEL, VIRTUAL_PORT_PATH } from '../../../../shared/virtual-device'
import {
  isWorkerEvent,
  isWorkerResponse,
  type DeviceMethod,
  type WorkerLike,
  type WorkerRequest,
  type WorkerToMainMessage
} from '../../../../shared/device/workerProtocol'

type StatusListener = (status: DeviceStatus) => void
type DataListener = (chunk: Uint8Array) => void

/** Builds a real `Worker` pointed at the bundled worker entry. Overridable in
 *  tests; production code never needs to call this directly. */
export function createMicroPythonWorker(): WorkerLike {
  return new Worker(new URL('./micropython.worker.ts', import.meta.url), {
    type: 'module'
  })
}

export class WorkerDeviceClient {
  private readonly worker: WorkerLike
  private nextId = 1
  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (err: Error) => void }
  >()
  private readonly statusListeners = new Set<StatusListener>()
  private readonly dataListeners = new Set<DataListener>()

  constructor(worker: WorkerLike = createMicroPythonWorker()) {
    this.worker = worker
    this.worker.onmessage = (ev: MessageEvent<WorkerToMainMessage>): void => this.handleMessage(ev.data)
  }

  private handleMessage(msg: WorkerToMainMessage): void {
    if (isWorkerResponse(msg)) {
      const waiter = this.pending.get(msg.id)
      if (!waiter) return
      this.pending.delete(msg.id)
      if (msg.ok) waiter.resolve(msg.value)
      else waiter.reject(new Error(msg.error))
      return
    }
    if (isWorkerEvent(msg)) {
      if (msg.event === 'data') {
        for (const listener of this.dataListeners) listener(msg.chunk)
      } else {
        for (const listener of this.statusListeners) listener(msg.status)
      }
    }
  }

  private call<T>(method: DeviceMethod, args: unknown[] = []): Promise<T> {
    const id = this.nextId++
    const request: WorkerRequest = { type: 'request', id, method, args }
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject })
      this.worker.postMessage(request)
    })
  }

  // -- device Api surface (mirrors src/preload/index.ts's `device` object) --

  /** The only "port" on the web build is the built-in simulated device — same
   *  identity Electron's `device:listPorts` injects for its offline mode
   *  (#135), so `ConnectionControl`'s dropdown/Connect flow works unchanged. */
  listPorts(): Promise<PortInfo[]> {
    return Promise.resolve([{ path: VIRTUAL_PORT_PATH, friendlyName: VIRTUAL_PORT_LABEL }])
  }

  connect(path?: string): Promise<void> {
    if (path && path !== VIRTUAL_PORT_PATH) {
      return Promise.reject(
        new Error(`Real serial devices aren't available in the web build yet (got "${path}").`)
      )
    }
    return this.call('connect')
  }

  disconnect(): Promise<void> {
    return this.call('disconnect')
  }

  getStatus(): Promise<DeviceStatus> {
    return this.call('getStatus')
  }

  exec(code: string): Promise<ExecResult> {
    return this.call('exec', [code])
  }

  eval(code: string): Promise<string> {
    return this.call('eval', [code])
  }

  sendData(data: string): Promise<void> {
    return this.call('sendData', [data])
  }

  sendControl(target: string, payload?: string): Promise<void> {
    return this.call('sendControl', [target, payload ?? ''])
  }

  interrupt(): Promise<void> {
    return this.call('interrupt')
  }

  softReset(): Promise<void> {
    return this.call('softReset')
  }

  listDir(path?: string): Promise<DirEntry[]> {
    return this.call('listDir', [path])
  }

  /** Flash usage (#211) — no dedicated worker method; runs the shared
   *  `DF_SNIPPET` over `exec()`, same as the Electron `device:df` handler. */
  async df(): Promise<DfResult | null> {
    const { stdout } = await this.exec(DF_SNIPPET)
    return parseDfOutput(stdout)
  }

  readFile(path: string): Promise<string> {
    return this.call('readFile', [path])
  }

  writeFile(path: string, contents: string): Promise<void> {
    return this.call('writeFile', [path, contents])
  }

  remove(path: string): Promise<void> {
    return this.call('remove', [path])
  }

  mkdir(path: string): Promise<void> {
    return this.call('mkdir', [path])
  }

  rename(from: string, to: string): Promise<void> {
    return this.call('rename', [from, to])
  }

  stat(path: string): Promise<StatResult> {
    return this.call('stat', [path])
  }

  onData(cb: DataListener): () => void {
    this.dataListeners.add(cb)
    return () => this.dataListeners.delete(cb)
  }

  /** Subscribe to status changes. Mirrors the preload API's IPC-listener
   *  behaviour of not replaying the last known status on subscribe — callers
   *  that need the current snapshot should call `getStatus()`. */
  onStatus(cb: StatusListener): () => void {
    this.statusListeners.add(cb)
    return () => this.statusListeners.delete(cb)
  }

  /** Terminate the worker (page/app teardown) — not part of the `device` Api,
   *  called by `createWebApi()`'s cleanup path if/when one exists. */
  dispose(): Promise<void> {
    return this.call<void>('dispose').finally(() => this.worker.terminate?.())
  }
}
