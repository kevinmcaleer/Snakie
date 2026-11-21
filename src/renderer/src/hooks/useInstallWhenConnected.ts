import { useCallback, useEffect, useRef, useState } from 'react'
import { dispatchDeviceAction } from '../components/device-bus'

/**
 * INSTALL IS NEVER A DEAD BUTTON.
 * =============================================================================
 *
 * Installing writes to the board, so it needs one. The Packages panel used to
 * grey its Install buttons out until a board was connected, which left a
 * newcomer staring at a button that did nothing. Now pressing Install with no
 * board asks the connection control to connect (the same `connect` device
 * action the Drivers chip uses), remembers what was asked for, and installs it
 * the moment the board arrives, so nobody has to press Install twice.
 *
 * `request(key)` installs now when connected, otherwise queues `key` and asks
 * for a connection. `isWaiting(key)` drives the row's "waiting for board"
 * label, and `waiting` the panel's "connect your board" line.
 */
export function useInstallWhenConnected(
  connected: boolean,
  install: (key: string) => void | Promise<void>
): {
  request: (key: string) => void
  isWaiting: (key: string) => boolean
  waiting: boolean
} {
  const [queue, setQueue] = useState<string[]>([])
  const installRef = useRef(install)
  installRef.current = install

  useEffect(() => {
    if (!connected || queue.length === 0) return
    const pending = queue
    setQueue([])
    // Each install goes through the device queue, so these take turns at the
    // port rather than racing.
    for (const key of pending) void installRef.current(key)
  }, [connected, queue])

  const request = useCallback(
    (key: string): void => {
      if (connected) {
        void installRef.current(key)
        return
      }
      setQueue((prev) => queueInstall(prev, key))
      dispatchDeviceAction('connect')
    },
    [connected]
  )

  const isWaiting = useCallback((key: string): boolean => queue.includes(key), [queue])

  return { request, isWaiting, waiting: queue.length > 0 }
}

/** Add `key` to the waiting list once: a second press keeps one entry. */
export function queueInstall(queue: readonly string[], key: string): string[] {
  return queue.includes(key) ? [...queue] : [...queue, key]
}

/** The line shown while an install waits for a board. */
export const WAITING_FOR_BOARD_HINT =
  'Connect your board to install. Plug it in and pick it in the console bar; the install starts as soon as it connects.'
