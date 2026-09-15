import { describe, expect, it } from 'vitest'
import { createHash } from 'crypto'
import { readFileSync } from 'fs'
import { join } from 'path'
import { parseLibVersion } from '../src/renderer/src/lib/instrumentsLib'

/**
 * Guard: `turtle.py` must not change without its `__version__` changing.
 * Mirrors `test/instrumentsLibVersion.test.ts` for `instruments.py` (#108) —
 * the IDE compares this version against a board's copy to offer the install
 * banner's UPDATE action, so an un-bumped edit would leave every board
 * silently running the OLD library while the app reports it as current.
 *
 * When you change `turtle.py`: bump `__version__`, run this test, and paste
 * the hash it prints into the map below.
 */
const LIB = join(__dirname, '..', 'micropython', 'turtle.py')

/** version → sha256 of the file that shipped as that version. */
const SHA_BY_VERSION: Record<string, string> = {
  '0.1.0': '4fcc2e370ea8206478259be8a866bf7e3246b7a33d30440cba4d7db6f1b4644b',
  '0.1.1': '048b1092c6b45284b2958aaa9d2e928faead81ca7ec39500ef990dd0f05d6a4d'
}

describe('turtle.py version discipline', () => {
  const source = readFileSync(LIB, 'utf-8')
  const version = parseLibVersion(source)
  const sha = createHash('sha256').update(source).digest('hex')

  it('declares a parseable __version__', () => {
    expect(version, 'turtle.py needs a `__version__ = "X.Y.Z"` literal').toBeTruthy()
  })

  it('matches the hash recorded for its version', () => {
    const expected = SHA_BY_VERSION[version!]
    expect(
      expected,
      `turtle.py declares ${version}, which isn't in SHA_BY_VERSION. If you ` +
        `bumped the version, add:\n  '${version}': '${sha}'`
    ).toBeTruthy()
    expect(
      sha,
      `turtle.py changed but __version__ is still ${version}. Boards would keep ` +
        `the old copy while the app reports them up to date. Bump __version__ and ` +
        `record the new hash:\n  '<new version>': '${sha}'`
    ).toBe(expected)
  })
})
