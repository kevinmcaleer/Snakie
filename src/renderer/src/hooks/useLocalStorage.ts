import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * A small typed wrapper around `localStorage` for persisting UI state
 * (panel sizes, collapsed flags, theme) across app restarts.
 *
 * Layout persistence lives entirely in the renderer per the issue #2
 * boundary — the main process and electron-store are deliberately untouched.
 */
export function useLocalStorage<T>(key: string, initialValue: T): [T, (value: T) => void] {
  // Hold the initial value in a ref. Callers routinely pass an INLINE literal
  // (e.g. `useLocalStorage('…', {})`) — a fresh reference every render. If
  // `readValue` depended on `initialValue` directly it would be recreated each
  // render, the key-sync effect below (dep `[readValue]`) would fire every
  // render, and — because `JSON.parse` returns a new object each call — it would
  // `setStoredValue` a new reference forever: "Maximum update depth exceeded".
  // Depending only on the (stable) `key` keeps `readValue` stable.
  const initialRef = useRef(initialValue)

  const readValue = useCallback((): T => {
    try {
      const raw = window.localStorage.getItem(key)
      return raw === null ? initialRef.current : (JSON.parse(raw) as T)
    } catch {
      // Corrupt/unavailable storage should never break the UI.
      return initialRef.current
    }
  }, [key])

  const [storedValue, setStoredValue] = useState<T>(readValue)

  const setValue = useCallback(
    (value: T) => {
      setStoredValue(value)
      try {
        window.localStorage.setItem(key, JSON.stringify(value))
      } catch {
        // Ignore write failures (e.g. storage disabled / quota).
      }
    },
    [key]
  )

  // Keep state in sync if the key changes (rare, but cheap to support).
  useEffect(() => {
    setStoredValue(readValue())
  }, [readValue])

  return [storedValue, setValue]
}
