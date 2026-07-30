import { describe, expect, it } from 'vitest'
import { createHash } from 'crypto'
import { readFileSync } from 'fs'
import { join } from 'path'
import { parseLibVersion } from '../src/renderer/src/lib/instrumentsLib'

/**
 * Guard: `instruments.py` must not change without its `__version__` changing.
 *
 * The IDE decides whether a board's copy is stale by comparing that version with
 * the bundled one. Edit the file and forget the bump, and every board silently
 * keeps running the OLD library while the app reports it as up to date — which is
 * exactly how a fixed `watch(imu=…)` classifier failed to reach a board, with no
 * error anywhere to explain the silence.
 *
 * When you change `instruments.py`: bump `__version__`, run this test, and paste
 * the hash it prints into the map below.
 */
const LIB = join(__dirname, '..', 'micropython', 'instruments.py')

/** version → sha256 of the file that shipped as that version. */
const SHA_BY_VERSION: Record<string, string> = {
  '0.10.0': '193e3609d1b1114d4093cb8b7c5048e37faa443ebef0fef74e21b8512838e885'
}

describe('instruments.py version discipline', () => {
  const source = readFileSync(LIB, 'utf-8')
  const version = parseLibVersion(source)
  const sha = createHash('sha256').update(source).digest('hex')

  it('declares a parseable __version__', () => {
    expect(version, 'instruments.py needs a `__version__ = "X.Y.Z"` literal').toBeTruthy()
  })

  it('matches the hash recorded for its version', () => {
    const expected = SHA_BY_VERSION[version!]
    expect(
      expected,
      `instruments.py declares ${version}, which isn't in SHA_BY_VERSION. If you ` +
        `bumped the version, add:\n  '${version}': '${sha}'`
    ).toBeTruthy()
    expect(
      sha,
      `instruments.py changed but __version__ is still ${version}. Boards would keep ` +
        `the old copy while the app reports them up to date. Bump __version__ and ` +
        `record the new hash:\n  '<new version>': '${sha}'`
    ).toBe(expected)
  })
})
