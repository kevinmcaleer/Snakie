/**
 * MicroPython Web Worker entry (epic #267 Phase W1) — the WASM sim's native
 * home per the epic doc. Boots a `WebSimulatedDevice` and speaks
 * `workerProtocol`'s RPC/event messages over `postMessage` with the main
 * thread. Bundled by Vite as a standalone worker chunk (the `new
 * Worker(new URL(...), { type: 'module' })` pattern in `WorkerDeviceClient`).
 *
 * Not unit-tested directly (it's a thin `postMessage` shim over
 * `WebSimulatedDevice`, which has its own full unit coverage) — exercised via
 * `WorkerDeviceClient`'s tests against a fake `WorkerLike`.
 */
import { loadMicroPython } from '@micropython/micropython-webassembly-pyscript/micropython.mjs'
// Vite resolves this to a same-origin, fetchable URL for the .wasm asset.
import wasmUrl from '@micropython/micropython-webassembly-pyscript/micropython.wasm?url'
import { WebMicroPythonRuntime } from '../../../../shared/device/webMicroPythonRuntime'
import { WebSimulatedDevice } from '../../../../shared/device/webSimulatedDevice'
import type {
  DeviceMethod,
  WorkerRequest,
  WorkerToMainMessage
} from '../../../../shared/device/workerProtocol'

/** The minimal `self` surface used here — avoids requiring the `webworker`
 *  TS lib (which conflicts with the renderer program's `dom` lib) just for
 *  `postMessage`/`onmessage` typing. */
interface WorkerContext {
  postMessage(message: unknown, transfer?: Transferable[]): void
  onmessage: ((ev: MessageEvent<WorkerRequest>) => void) | null
}
const ctx = self as unknown as WorkerContext

const device = new WebSimulatedDevice(new WebMicroPythonRuntime(wasmUrl, loadMicroPython))

function post(msg: WorkerToMainMessage, transfer?: Transferable[]): void {
  ctx.postMessage(msg, transfer)
}

device.on('data', (chunk) => post({ type: 'event', event: 'data', chunk }, [chunk.buffer]))
device.on('status', (status) => post({ type: 'event', event: 'status', status }))

/** One handler per {@link DeviceMethod}, dispatched by name from the RPC
 *  request. Untyped `args` — each handler knows its own arity/shape. */
const methods: Record<DeviceMethod, (args: unknown[]) => Promise<unknown>> = {
  connect: () => device.connect(),
  disconnect: () => device.disconnect(),
  getStatus: async () => device.getStatus(),
  exec: ([code]) => device.exec(code as string),
  eval: ([code]) => device.eval(code as string),
  sendData: ([data]) => device.sendData(data as string),
  sendControl: ([target, payload]) =>
    device.sendControl(target as string, payload as string | undefined),
  interrupt: () => device.interrupt(),
  softReset: () => device.softReset(),
  listDir: ([path]) => device.listDir(path as string | undefined),
  readFile: ([path]) => device.readFile(path as string),
  writeFile: ([path, contents]) => device.writeFile(path as string, contents as string),
  remove: ([path]) => device.remove(path as string),
  mkdir: ([path]) => device.mkdir(path as string),
  rename: ([from, to]) => device.rename(from as string, to as string),
  stat: ([path]) => device.stat(path as string),
  dispose: () => device.dispose()
}

ctx.onmessage = (ev) => {
  const req = ev.data
  if (!req || req.type !== 'request') return
  const handler = methods[req.method]
  if (!handler) {
    post({ type: 'response', id: req.id, ok: false, error: `Unknown device method: ${req.method}` })
    return
  }
  handler(req.args)
    .then((value) => post({ type: 'response', id: req.id, ok: true, value }))
    .catch((err) =>
      post({
        type: 'response',
        id: req.id,
        ok: false,
        error: err instanceof Error ? err.message : String(err)
      })
    )
}
