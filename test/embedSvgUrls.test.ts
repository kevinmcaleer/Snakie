import { describe, expect, it } from 'vitest'
import { unquoteUrls } from '../src/renderer/src/embed/svg-urls'

describe('unquoteUrls', () => {
  it('unquotes fragment references, which a host SVG cleaner may reject quoted', () => {
    expect(unquoteUrls('url("#wc-paper")')).toBe('url(#wc-paper)')
    expect(unquoteUrls("url( '#wc-grid-rough' )")).toBe('url(#wc-grid-rough)')
  })

  it('leaves everything else alone', () => {
    expect(unquoteUrls('url("https://example.com/a.png")')).toBe('url("https://example.com/a.png")')
    expect(unquoteUrls('rgb(31, 79, 143)')).toBe('rgb(31, 79, 143)')
    expect(unquoteUrls('none')).toBe('none')
  })
})
