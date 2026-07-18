/**
 * Platform capability detection (Web W3, issue #284, part of epic #267).
 *
 * The renderer already runs both inside Electron (the shipped desktop app,
 * with a real `window.api` bridge injected by the preload script) AND outside
 * it (a plain browser tab, e.g. during the eventual web build — see
 * `preloadFallback.ts`, which stubs `window.api` in that case). This module is
 * the single place that answers "which environment am I in", so:
 *
 *  - `preloadFallback.ts` uses it to decide whether a missing `window.api` is
 *    an actual bug (Electron, preload failed to load) or expected (browser).
 *  - UI chrome that only makes sense on desktop (Source Control, Plugins —
 *    both need a real filesystem + a spawned process, neither of which a
 *    browser tab can provide) is hidden via `isElectron()`.
 *  - Browser-native firmware flashing (Web Serial / WebUSB / File System
 *    Access) is offered only where the underlying browser API actually
 *    exists, via the `has*()` checks below.
 *
 * Every check here is a cheap, synchronous, side-effect-free feature test —
 * safe to call on every render.
 */

/** True when running inside Electron's renderer process (the desktop app). */
export function isElectron(): boolean {
  return typeof navigator !== 'undefined' && /electron/i.test(navigator.userAgent)
}

/** Web Serial (`navigator.serial`) — used for ESP32/ESP8266 flashing via esptool-js. */
export function hasWebSerial(): boolean {
  return typeof navigator !== 'undefined' && 'serial' in navigator
}

/** WebUSB (`navigator.usb`) — used for BBC micro:bit flashing via DAPLink. */
export function hasWebUSB(): boolean {
  return typeof navigator !== 'undefined' && 'usb' in navigator
}

/**
 * File System Access API's save-file picker — used by the guided drive-copy
 * flash flow (RP2040 UF2, and the micro:bit fallback when WebUSB isn't
 * available) to write firmware straight onto a user-picked mounted drive.
 */
export function hasFileSystemAccess(): boolean {
  return typeof window !== 'undefined' && 'showSaveFilePicker' in window
}
