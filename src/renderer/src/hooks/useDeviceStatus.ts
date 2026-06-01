import { useEffect, useState } from 'react'
import type { DeviceStatus } from '../../../preload/index.d'

const INITIAL: DeviceStatus = { state: 'disconnected' }

/**
 * Subscribe to live device connection status.
 *
 * Reads the current snapshot once on mount (`getStatus`) and then tracks every
 * push from `onStatus`. Multiple components (the toolbar indicator and the
 * shell connection control) each call this independently — the device layer
 * broadcasts to all subscribers, so they stay in sync without shared state.
 */
export function useDeviceStatus(): DeviceStatus {
  const [status, setStatus] = useState<DeviceStatus>(INITIAL)

  useEffect(() => {
    let active = true
    window.api.device
      .getStatus()
      .then((s) => {
        if (active) setStatus(s)
      })
      .catch(() => undefined)

    const unsubscribe = window.api.device.onStatus((s) => setStatus(s))
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  return status
}
