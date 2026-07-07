import { describe, it, expect, vi } from 'vitest'
import { WorkerDeviceClient } from '../src/renderer/src/web/device/WorkerDeviceClient'
import type { WorkerLike, WorkerRequest, WorkerToMainMessage } from '../src/shared/device/workerProtocol'

/** In-memory `WorkerLike` double — captures posted requests and lets the test
 *  drive worker→main responses/events without a real `Worker`. */
class FakeWorker implements WorkerLike {
  onmessage: ((ev: MessageEvent) => void) | null = null
  readonly posted: WorkerRequest[] = []
  terminated = false

  postMessage(message: unknown): void {
    this.posted.push(message as WorkerRequest)
  }

  terminate(): void {
    this.terminated = true
  }

  /** Simulate the worker posting a message back to the main thread. */
  emit(msg: WorkerToMainMessage): void {
    this.onmessage?.({ data: msg } as MessageEvent)
  }

  /** Convenience: respond `ok` to the most recently posted request. */
  respondToLast(value: unknown): void {
    const req = this.posted[this.posted.length - 1]
    this.emit({ type: 'response', id: req.id, ok: true, value })
  }

  rejectLast(error: string): void {
    const req = this.posted[this.posted.length - 1]
    this.emit({ type: 'response', id: req.id, ok: false, error })
  }
}

describe('WorkerDeviceClient', () => {
  it('round-trips exec() through postMessage/onmessage', async () => {
    const worker = new FakeWorker()
    const client = new WorkerDeviceClient(worker)

    const pending = client.exec('print(1)')
    expect(worker.posted).toEqual([{ type: 'request', id: 1, method: 'exec', args: ['print(1)'] }])
    worker.respondToLast({ stdout: '1\r\n', stderr: '' })

    await expect(pending).resolves.toEqual({ stdout: '1\r\n', stderr: '' })
  })

  it('rejects the call promise on an error response', async () => {
    const worker = new FakeWorker()
    const client = new WorkerDeviceClient(worker)

    const pending = client.eval('1/0')
    worker.rejectLast('ZeroDivisionError')

    await expect(pending).rejects.toThrow('ZeroDivisionError')
  })

  it('dispatches data events to onData subscribers', () => {
    const worker = new FakeWorker()
    const client = new WorkerDeviceClient(worker)
    const onData = vi.fn()
    client.onData(onData)

    const chunk = new Uint8Array([72, 105])
    worker.emit({ type: 'event', event: 'data', chunk })

    expect(onData).toHaveBeenCalledWith(chunk)
  })

  it('dispatches status events to onStatus subscribers and supports unsubscribe', () => {
    const worker = new FakeWorker()
    const client = new WorkerDeviceClient(worker)
    const onStatus = vi.fn()
    const unsubscribe = client.onStatus(onStatus)

    worker.emit({ type: 'event', event: 'status', status: { state: 'connected' } })
    expect(onStatus).toHaveBeenCalledWith({ state: 'connected' })

    unsubscribe()
    worker.emit({ type: 'event', event: 'status', status: { state: 'disconnected' } })
    expect(onStatus).toHaveBeenCalledTimes(1)
  })

  it('df() runs the shared DF_SNIPPET over exec() and parses the result', async () => {
    const worker = new FakeWorker()
    const client = new WorkerDeviceClient(worker)

    const pending = client.df()
    expect(worker.posted[0].method).toBe('exec')
    worker.respondToLast({ stdout: 'SNKDF 1000 400\r\n', stderr: '' })

    await expect(pending).resolves.toEqual({ total: 1000, free: 400, used: 600 })
  })

  it('df() returns null when the device cannot statvfs', async () => {
    const worker = new FakeWorker()
    const client = new WorkerDeviceClient(worker)

    const pending = client.df()
    worker.respondToLast({ stdout: 'SNKDF -1 -1\r\n', stderr: '' })

    await expect(pending).resolves.toBeNull()
  })

  it('listPorts() resolves the built-in simulated-device virtual port', async () => {
    const client = new WorkerDeviceClient(new FakeWorker())
    await expect(client.listPorts()).resolves.toEqual([
      { path: 'snakie://virtual', friendlyName: 'Simulated device (offline)' }
    ])
  })

  it('connect() rejects a real port path (not available on the web build)', async () => {
    const client = new WorkerDeviceClient(new FakeWorker())
    await expect(client.connect('/dev/ttyUSB0')).rejects.toThrow(/web build/i)
  })

  it('connect() with no path (or the virtual port path) calls the worker', async () => {
    const worker = new FakeWorker()
    const client = new WorkerDeviceClient(worker)

    const pending = client.connect('snakie://virtual')
    expect(worker.posted[0].method).toBe('connect')
    worker.respondToLast(undefined)
    await expect(pending).resolves.toBeUndefined()
  })

  it('dispose() sends the dispose RPC and terminates the worker', async () => {
    const worker = new FakeWorker()
    const client = new WorkerDeviceClient(worker)

    const pending = client.dispose()
    expect(worker.posted[0].method).toBe('dispose')
    worker.respondToLast(undefined)

    await pending
    expect(worker.terminated).toBe(true)
  })

  it('sendControl() defaults payload to an empty string', () => {
    const worker = new FakeWorker()
    const client = new WorkerDeviceClient(worker)

    void client.sendControl('led')
    expect(worker.posted[0]).toEqual({ type: 'request', id: 1, method: 'sendControl', args: ['led', ''] })
  })
})
