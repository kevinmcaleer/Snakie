import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { createHash } from 'crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'

/**
 * #750, the seeder's half: refreshing a bundled part to a newer bundle must not
 * take out files that came from somewhere else.
 *
 * `syncBundledLibrary` classifies a part as "untouched since we seeded it" on
 * the hash of `parts.yml` and NOTHING ELSE — so a part whose folder the user has
 * added a mesh or a datasheet to still counts as untouched. It then used to
 * `rm -rf` that folder before copying the bundle in, which is the same "prune
 * the folder to match my own idea of the part" hammer that deleted
 * `modulino-led-matrix/help.md` and `modulino.stl`.
 *
 * Its own file, because `seedStandardLibrary` memoises its first run for the
 * life of the module (vitest isolates modules per test file, so one seed here).
 */

const ROOT = vi.hoisted(
  () => `${(process.env.TMPDIR || '/tmp').replace(/\/$/, '')}/snakie-750-seed-${process.pid}`
)
const USER_DATA = `${ROOT}/userData`
const RESOURCES = `${ROOT}/resources`

vi.mock('electron', () => ({
  app: { getPath: () => USER_DATA, isPackaged: true }
}))

const { seedStandardLibrary } = await import('../src/main/parts/library')

const LIB = 'snakie-standard'
const PART = 'seeded-widget'
const bundlePart = join(RESOURCES, 'examples', 'parts', LIB, PART)
const localLib = join(USER_DATA, 'parts', LIB)
const localPart = join(localLib, PART)

/** A valid part; `version` is what moves between the seeded and bundled copies. */
const partYaml = (version: string): string =>
  [
    `id: ${PART}`,
    'name: Seeded Widget',
    `version: ${version}`,
    'headers:',
    '  - edge: bottom',
    '    pins:',
    '      - name: SDA',
    '        type: io',
    '        number: 1',
    ''
  ].join('\n')

const SEEDED = partYaml('0.1.0')
const BUNDLED = partYaml('0.2.0')

beforeAll(async () => {
  rmSync(ROOT, { recursive: true, force: true })

  // The app's bundle: a newer library version, and a newer copy of the part.
  mkdirSync(bundlePart, { recursive: true })
  writeFileSync(join(RESOURCES, 'examples', 'parts', LIB, 'library.yml'), 'id: snakie-standard\nname: Standard\nversion: 2.0.0\n', 'utf-8')
  writeFileSync(join(bundlePart, 'parts.yml'), BUNDLED, 'utf-8')

  // The install: seeded from an older bundle, `parts.yml` untouched since — but
  // with two files of the user's own sitting beside it.
  mkdirSync(localPart, { recursive: true })
  writeFileSync(join(localPart, 'parts.yml'), SEEDED, 'utf-8')
  writeFileSync(join(localPart, 'my-notes.stl'), 'solid mine\nendsolid\n', 'utf-8')
  writeFileSync(join(localPart, 'datasheet.pdf'), '%PDF-1.4 mine\n', 'utf-8')
  writeFileSync(
    join(localLib, '.snakie-seed.json'),
    JSON.stringify({
      version: '1.0.0',
      parts: { [PART]: createHash('sha256').update(SEEDED).digest('hex') }
    }),
    'utf-8'
  )

  // `bundledStandardLibraryDir()` reads this when packaged.
  ;(process as NodeJS.Process & { resourcesPath: string }).resourcesPath = RESOURCES
  await seedStandardLibrary()
})

afterAll(() => rmSync(ROOT, { recursive: true, force: true }))

describe('syncBundledLibrary refresh (#750)', () => {
  it('adopts the newer bundled parts.yml', () => {
    expect(readFileSync(join(localPart, 'parts.yml'), 'utf-8')).toBe(BUNDLED)
  })

  it('leaves the files beside it that the bundle knows nothing about', () => {
    expect(existsSync(join(localPart, 'my-notes.stl'))).toBe(true)
    expect(existsSync(join(localPart, 'datasheet.pdf'))).toBe(true)
  })
})
