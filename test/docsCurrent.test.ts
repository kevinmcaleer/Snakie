import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'

/**
 * The docs still describe the app that ships (#962).
 *
 * `docs/micropython-boards.md` claimed 219 boards from a July snapshot while the
 * shipped index held 225 from MicroPython v1.29.0, and the README announced
 * "v0.13.0 released" at v0.54.x. Both drifted for the same reason: a fact that
 * has to be retyped is a fact that goes quietly wrong, and a reference that is
 * quietly wrong is worse than none because the reader trusts it.
 *
 * So the catalogue is generated now, and this checks it still matches its
 * source. Prose cannot be tested and is not the target here — the numbers are.
 */

const index = JSON.parse(readFileSync('src/renderer/public/boards/boards.json', 'utf8'))
const boardsDoc = readFileSync('docs/micropython-boards.md', 'utf8')
const readme = readFileSync('README.md', 'utf8')

describe('the board catalogue matches the index it came from', () => {
  it('states the same total', () => {
    const m = /\*\*Total boards:\*\* (\d+)/.exec(boardsDoc)
    expect(m, 'the doc no longer states a total').toBeTruthy()
    expect(Number(m![1])).toBe(index.boards.length)
  })

  it('names the MicroPython release it was built from', () => {
    expect(boardsDoc).toContain(`\`${index.micropython}\``)
  })

  it('has a row per board', () => {
    // Every board reachable in the table, not just a plausible-looking count in
    // the header — the two drifting apart is how it went wrong before.
    for (const b of index.boards) {
      expect(boardsDoc, `${b.id} is missing from the table`).toContain(`\`${b.id}\``)
    }
  })

  it('says how to regenerate it, and not to edit it by hand', () => {
    expect(boardsDoc).toContain('do not edit by hand')
    expect(boardsDoc).toContain('scripts/build-boards-doc.mjs')
  })
})

describe('the README does not pin a version that will rot', () => {
  it('announces no specific released version', () => {
    // It said "v0.13.0 released" for forty-one minor versions. The fix is not a
    // newer number — it is not having one here at all, since Releases has it.
    expect(readme).not.toMatch(/\*\*v\d+\.\d+\.\d+ released\*\*/)
  })

  it('describes what the app can actually do now', () => {
    // None of this run's work appeared anywhere in the docs.
    for (const feature of ['Board Finder', 'Application menus', '.mpy']) {
      expect(readme, `README never mentions ${feature}`).toContain(feature)
    }
  })
})

describe('no doc retypes the version that package.json already holds', () => {
  it('states nowhere what package.json currently says', () => {
    // `docs/blockly-epic.md` told its reader "current `package.json` is
    // `0.56.0`" twelve minor versions after that stopped being true — the same
    // failure as the README's "v0.13.0 released", for the same reason. The fix
    // is not a fresher number but no number: `package.json` is one file away,
    // and a plan that pins its own shipped range says something that stays true.
    const pinned = /`?package\.json`?[^.\n]{0,40}?\b(?:is|was|=)\s*`?v?\d+\.\d+\.\d+/i
    const docs = readdirSync('docs')
      .filter((f) => f.endsWith('.md'))
      .map((f) => `docs/${f}`)
    for (const file of [...docs, 'README.md', 'CLAUDE.md']) {
      const m = pinned.exec(readFileSync(file, 'utf8'))
      expect(m?.[0], `${file} restates package.json's version: "${m?.[0]}"`).toBeUndefined()
    }
  })
})
