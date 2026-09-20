import { describe, expect, it } from 'vitest'
// Plain ESM build script — allowJs resolves it, no type declarations needed.
import { parseName, bucketsOf, renderSections, unreleasedSection } from '../scripts/changelog.mjs'

/**
 * Unit tests for the pure halves of `scripts/changelog.mjs` — the fragment
 * naming convention and the assembly that folds fragments (and whatever is
 * still sitting in `[Unreleased]`) into one release section.
 */
describe('parseName', () => {
  it('reads the issue, slug and type out of a fragment filename', () => {
    expect(parseName('1246-detect-firmware-modules.added.md')).toEqual({
      type: 'added',
      issue: 1246,
      slug: 'detect-firmware-modules'
    })
  })

  it('allows a fragment with no issue number', () => {
    expect(parseName('tidy-status-bar.fixed.md')).toEqual({
      type: 'fixed',
      issue: null,
      slug: 'tidy-status-bar'
    })
  })

  it('rejects a name whose type is not a Keep a Changelog section', () => {
    expect(parseName('123-thing.improved.md')).toBeNull()
    expect(parseName('notes.md')).toBeNull()
  })
})

describe('renderSections', () => {
  it('groups fragments under their headings in Keep a Changelog order', () => {
    const out = renderSections(new Map(), [
      { type: 'fixed', issue: 2, slug: 'b', body: '- fixed thing' },
      { type: 'added', issue: 1, slug: 'a', body: '- added thing' }
    ])
    expect(out).toBe('### Added\n\n- added thing\n\n### Fixed\n\n- fixed thing')
  })

  it('merges the duplicate headings a union merge leaves in [Unreleased]', () => {
    const body = '\n\n### Added\n\n- one\n\n### Changed\n\n- two\n\n### Added\n\n- three\n'
    const out = renderSections(bucketsOf(body), [])
    expect(out).toBe('### Added\n\n- one\n\n- three\n\n### Changed\n\n- two')
  })

  it('keeps an unrecognised heading rather than dropping its entries', () => {
    const out = renderSections(bucketsOf('\n### Notes\n\n- kept\n'), [])
    expect(out).toBe('### Notes\n\n- kept')
  })
})

describe('unreleasedSection', () => {
  it('spans from the heading to the next release section', () => {
    const text = '# Changelog\n\n## [Unreleased]\n\n### Added\n\n- new\n\n## [0.1.0] - 2026-01-01\n\n- old\n'
    const { body } = unreleasedSection(text)
    expect(body.trim()).toBe('### Added\n\n- new')
  })

  it('throws when there is no [Unreleased] heading to fold', () => {
    expect(() => unreleasedSection('# Changelog\n')).toThrow(/Unreleased/)
  })
})
