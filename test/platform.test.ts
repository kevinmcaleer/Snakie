import { afterEach, describe, expect, it, vi } from 'vitest'
import { hasFileSystemAccess, hasWebSerial, hasWebUSB, isElectron } from '../src/renderer/src/lib/platform'

describe('platform capability detection', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('isElectron() is true when the user agent contains "Electron"', () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 Snakie/1.0 Electron/28.0.0' })
    expect(isElectron()).toBe(true)
  })

  it('isElectron() is false for a plain browser user agent', () => {
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120.0'
    })
    expect(isElectron()).toBe(false)
  })

  it('isElectron() is false when navigator is unavailable', () => {
    vi.stubGlobal('navigator', undefined)
    expect(isElectron()).toBe(false)
  })

  it('hasWebSerial() reflects navigator.serial presence', () => {
    vi.stubGlobal('navigator', { userAgent: 'x' })
    expect(hasWebSerial()).toBe(false)
    vi.stubGlobal('navigator', { userAgent: 'x', serial: {} })
    expect(hasWebSerial()).toBe(true)
  })

  it('hasWebUSB() reflects navigator.usb presence', () => {
    vi.stubGlobal('navigator', { userAgent: 'x' })
    expect(hasWebUSB()).toBe(false)
    vi.stubGlobal('navigator', { userAgent: 'x', usb: {} })
    expect(hasWebUSB()).toBe(true)
  })

  it('hasFileSystemAccess() reflects window.showSaveFilePicker presence', () => {
    vi.stubGlobal('window', {})
    expect(hasFileSystemAccess()).toBe(false)
    vi.stubGlobal('window', { showSaveFilePicker: () => {} })
    expect(hasFileSystemAccess()).toBe(true)
  })

  it('hasFileSystemAccess() is false when window is unavailable', () => {
    vi.stubGlobal('window', undefined)
    expect(hasFileSystemAccess()).toBe(false)
  })
})
