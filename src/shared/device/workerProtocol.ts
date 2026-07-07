/**
 * Main-thread ⇄ Web-Worker RPC/event protocol for the browser MicroPython
 * simulated device (epic #267 Phase W1). No Node/Electron dependency, no
 * `Worker` global reference (only a minimal `WorkerLike` transport shape) so
 * this is importable from both the worker entry and the main-thread client,
 * and driveable in tests with an in-memory fake.
 *
 * Every `device` Api method (see `src/preload/index.ts`'s `device` object)
 * becomes one {@link WorkerRequest}/{@link WorkerResponse} round trip; the
 * device's `data`/`status` event stream becomes unsolicited
 * {@link WorkerEvent} messages pushed from the worker.
 */
import type { DeviceStatus } from '../../main/device/types'

/** Every RPC-able method on the simulated device. */
export type DeviceMethod =
  | 'connect'
  | 'disconnect'
  | 'getStatus'
  | 'exec'
  | 'eval'
  | 'sendData'
  | 'sendControl'
  | 'interrupt'
  | 'softReset'
  | 'listDir'
  | 'readFile'
  | 'writeFile'
  | 'remove'
  | 'mkdir'
  | 'rename'
  | 'stat'
  | 'dispose'

/** A request from the main thread to the worker. */
export interface WorkerRequest {
  type: 'request'
  id: number
  method: DeviceMethod
  args: unknown[]
}

/** The worker's reply to a {@link WorkerRequest}, matched by `id`. */
export type WorkerResponse =
  | { type: 'response'; id: number; ok: true; value: unknown }
  | { type: 'response'; id: number; ok: false; error: string }

/** Unsolicited push from the worker — the device's `data`/`status` stream. */
export type WorkerEvent =
  | { type: 'event'; event: 'data'; chunk: Uint8Array }
  | { type: 'event'; event: 'status'; status: DeviceStatus }

/** Everything the worker can post to the main thread. */
export type WorkerToMainMessage = WorkerResponse | WorkerEvent

/** The minimal `Worker` surface this protocol needs — real `Worker` instances
 *  satisfy it; tests can substitute an in-memory fake. Kept structural (no
 *  `instanceof Worker`) so it works identically in Node/vitest and the
 *  browser. */
export interface WorkerLike {
  postMessage(message: unknown, transfer?: Transferable[]): void
  set onmessage(handler: ((ev: MessageEvent) => void) | null)
  terminate?(): void
}

/** Type guard for {@link WorkerResponse}. */
export function isWorkerResponse(msg: WorkerToMainMessage): msg is WorkerResponse {
  return msg.type === 'response'
}

/** Type guard for {@link WorkerEvent}. */
export function isWorkerEvent(msg: WorkerToMainMessage): msg is WorkerEvent {
  return msg.type === 'event'
}
