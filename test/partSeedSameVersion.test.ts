import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { createHash } from 'crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'

/**
 * A part that changes WITHOUT a `library.yml` version bump must still reach an
 * install that already has it.
 *
 * This is how the Yellow TT Motor lost its 3-D model: 0.85.4 gave `tt-motor` a
 * `mesh: model.stl` and shipped the STL beside it, but the library's declared
 * version stayed at 1.15.0. `syncBundledLibrary` took the "already tracking this
 * bundle" fast path, which only copied wholly-new part folders, so every install
 * that had seeded the motor before kept the meshless copy — and the Build
 * workspace drew a footprint box for it for ever.
 *
 * Its own file: `seedStandardLibrary` memoises its first run for the life of the
 * module, so one seed per test file.
 */

const ROOT = vi.hoisted(
  () => `${(process.env.TMPDIR || '/tmp').replace(/\/$/, '')}/snakie-seed-same-version-${process.pid}`
)
const USER_DATA = `${ROOT}/userData`
const RESOURCES = `${ROOT}/resources`

vi.mock('electron', () => ({
  app: { getPath: () => USER_DATA, isPackaged: true }
}))

const { seedStandardLibrary } = await import('../src/main/parts/library')

const LIB = 'snakie-standard'
const PART = 'tt-motor-ish'
const LIB_VERSION = '1.15.0'
const bundleLib = join(RESOURCES, 'examples', 'parts', LIB)
const bundlePart = join(bundleLib, PART)
const localLib = join(USER_DATA, 'parts', LIB)
const localPart = join(localLib, PART)

const partYaml = (version: string, mesh: boolean): string =>
  [
    `id: ${PART}`,
    'name: Yellow TT Motor',
    `version: ${version}`,
    ...(mesh ? ['mesh: model.stl', 'meshUnits: mm'] : []),
    'headers:',
    '  - edge: top',
    '    pins:',
    '      - name: VCC',
    '        type: pwr',
    '        number: 1',
    ''
  ].join('\n')

const SEEDED = partYaml('0.1.0', false)
const BUNDLED = partYaml('0.2.1', true)
const STL = 'solid motor\nendsolid motor\n'

beforeAll(async () => {
  rmSync(ROOT, { recursive: true, force: true })

  // The bundle: the part gained a mesh, the library version did NOT move.
  mkdirSync(bundlePart, { recursive: true })
  writeFileSync(
    join(bundleLib, 'library.yml'),
    `id: snakie-standard\nname: Standard\nversion: ${LIB_VERSION}\n`,
    'utf-8'
  )
  writeFileSync(join(bundlePart, 'parts.yml'), BUNDLED, 'utf-8')
  writeFileSync(join(bundlePart, 'model.stl'), STL, 'utf-8')

  // The install: the meshless copy, seeded from a bundle declaring the SAME version.
  mkdirSync(localPart, { recursive: true })
  writeFileSync(join(localPart, 'parts.yml'), SEEDED, 'utf-8')
  writeFileSync(
    join(localLib, '.snakie-seed.json'),
    JSON.stringify({
      version: LIB_VERSION,
      parts: { [PART]: createHash('sha256').update(SEEDED).digest('hex') }
    }),
    'utf-8'
  )
  ;(process as NodeJS.Process & { resourcesPath: string }).resourcesPath = RESOURCES
  await seedStandardLibrary()
})

afterAll(() => rmSync(ROOT, { recursive: true, force: true }))

describe('syncBundledLibrary with an unchanged library version', () => {
  it('still refreshes a part the bundle changed', () => {
    expect(readFileSync(join(localPart, 'parts.yml'), 'utf-8')).toBe(BUNDLED)
  })

  it('brings the mesh the refreshed parts.yml names with it', () => {
    expect(existsSync(join(localPart, 'model.stl'))).toBe(true)
    expect(readFileSync(join(localPart, 'model.stl'), 'utf-8')).toBe(STL)
  })
})
