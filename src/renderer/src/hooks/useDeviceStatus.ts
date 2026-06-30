import { useEffect, useState } from 'react'
import type { DeviceStatus } from '../../../preload/index.d'

const INITIAL: DeviceStatus = { state: 'disconnected' }

/**
 * SHARED device-status subscription.
 *
 * `useDeviceStatus` is used by ~18 components (toolbar, status bar, file trees,
 * every instrument …). If each added its own `ipcRenderer.on('device:status')`
 * listener we'd cross Node's 10-listener default and log a spurious
 * `MaxListenersExceededWarning`. Instead we keep ONE upstream subscription and
 * fan the latest status out to every mounted hook, caching it so new subscribers
 * get the current value immediately (no per-component `getStatus` round-trip).
 */
let latest: DeviceStatus = INITIAL
const subscribers = new Set<(s: DeviceStatus) => void>()
let unsubscribeUpstream: (() => void) | null = null

function emit(s: DeviceStatus): void {
  latest = s
  for (const fn of subscribers) fn(s)
}

function ensureUpstream(): void {
  if (unsubscribeUpstream) return
  // Seed from the current snapshot once, then track every push.
  window.api.device
    .getStatus()
    .then(emit)
    .catch(() => undefined)
  unsubscribeUpstream = window.api.device.onStatus(emit)
}

/**
 * Subscribe to live device connection status. Reads the cached snapshot on mount
 * and tracks every push, via the single shared upstream subscription above.
 */
export function useDeviceStatus(): DeviceStatus {
  const [status, setStatus] = useState<DeviceStatus>(latest)

  useEffect(() => {
    ensureUpstream()
    subscribers.add(setStatus)
    // Sync to the latest cached value in case it changed before this effect ran.
    setStatus(latest)
    return () => {
      subscribers.delete(setStatus)
      // Drop the upstream listener once nothing is observing, so the renderer's
      // device:status listener count stays at 0/1 and never accumulates.
      if (subscribers.size === 0 && unsubscribeUpstream) {
        unsubscribeUpstream()
        unsubscribeUpstream = null
      }
    }
  }, [])

  return status
}
