import { describe, expect, it } from 'vitest'
import postcss from 'postcss'
import { embedScope, scopeSelector } from '../vite-plugin-embed-scope'

// snakie#1277: the embeddable bundle's CSS lives under .snakie-embed, so it can
// share a page with the host's (kevsrobots uses Bootstrap's .btn).
describe('embed CSS scope', () => {
  it('moves :root, html and body onto the embed root', () => {
    expect(scopeSelector(':root')).toBe('.snakie-embed')
    expect(scopeSelector(":root[data-theme='skeuomorph'] .btn")).toBe(".snakie-embed[data-theme='skeuomorph'] .btn")
    expect(scopeSelector('html body .x')).toBe('.snakie-embed .x')
    expect(scopeSelector('body')).toBe('.snakie-embed')
  })

  it('prefixes everything else, once', () => {
    expect(scopeSelector('.btn:hover')).toBe('.snakie-embed .btn:hover')
    expect(scopeSelector('*')).toBe('.snakie-embed *')
    expect(scopeSelector('.snakie-embed--wiring > *')).toBe('.snakie-embed--wiring > *')
    // A class that merely starts with "body" is not body.
    expect(scopeSelector('.bodyish')).toBe('.snakie-embed .bodyish')
    expect(scopeSelector('htmlx')).toBe('.snakie-embed htmlx')
  })

  it('rewrites a stylesheet but leaves keyframes and font faces', async () => {
    const css = [
      ':root { --panel: #fff }',
      '.btn, a:hover { color: red }',
      '@media (max-width: 600px) { .pl__search { display: none } }',
      '@keyframes spin { from { opacity: 0 } to { opacity: 1 } }',
      "@font-face { font-family: X; src: url(x.woff2) }"
    ].join('\n')
    const out = (await postcss([embedScope()]).process(css, { from: undefined })).css
    expect(out).toContain('.snakie-embed { --panel: #fff }')
    expect(out).toContain('.snakie-embed .btn, .snakie-embed a:hover')
    expect(out).toContain('.snakie-embed .pl__search')
    expect(out).toContain('from { opacity: 0 }')
    expect(out).toContain('@font-face { font-family: X')
  })
})
