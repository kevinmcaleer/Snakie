import { describe, it, expect } from 'vitest'
import { isWorkerEvent, isWorkerResponse } from '../src/shared/device/workerProtocol'
import type { WorkerToMainMessage } from '../src/shared/device/workerProtocol'

describe('workerProtocol type guards', () => {
  it('isWorkerResponse recognises response messages only', () => {
    const response: WorkerToMainMessage = { type: 'response', id: 1, ok: true, value: 'x' }
    const event: WorkerToMainMessage = { type: 'event', event: 'status', status: { state: 'connected' } }
    expect(isWorkerResponse(response)).toBe(true)
    expect(isWorkerResponse(event)).toBe(false)
  })

  it('isWorkerEvent recognises event messages only', () => {
    const event: WorkerToMainMessage = { type: 'event', event: 'data', chunk: new Uint8Array([1]) }
    const response: WorkerToMainMessage = { type: 'response', id: 2, ok: false, error: 'boom' }
    expect(isWorkerEvent(event)).toBe(true)
    expect(isWorkerEvent(response)).toBe(false)
  })
})
