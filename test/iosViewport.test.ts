import { describe, expect, it } from 'vitest'
import { isIOS, withMaximumScale } from '../src/renderer/src/lib/ios-viewport'

describe('iOS viewport fix', () => {
  it('recognises iPhone, iPod and iPad user agents', () => {
    expect(isIOS('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', 'iPhone', 5)).toBe(true)
    expect(isIOS('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)', 'iPad', 5)).toBe(true)
  })

  it('recognises iPadOS, which reports itself as a Mac with a touch screen', () => {
    expect(isIOS('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel', 5)).toBe(true)
  })

  it('leaves real Macs, Android and desktops alone', () => {
    expect(isIOS('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel', 0)).toBe(false)
    expect(isIOS('Mozilla/5.0 (Linux; Android 14; Pixel 8)', 'Linux armv8l', 5)).toBe(false)
    expect(isIOS('Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Win32', 0)).toBe(false)
  })

  it('adds maximum-scale=1 once', () => {
    const base = 'width=device-width, initial-scale=1.0, viewport-fit=cover'
    const once = withMaximumScale(base)
    expect(once).toBe(`${base}, maximum-scale=1`)
    expect(withMaximumScale(once)).toBe(once)
  })
})
