import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { createHash } from 'crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'

/**
 * #638 follow-up: a part the app STOPS shipping has to leave the install too.
 *
 * `syncBundledLibrary` walks the bundle's folders, so a dropped part was never
 * visited and lived on forever. That is why removing the typo'd `hr-sr04`
 * duplicate changed nothing for anyone who already had it: their catalog still
 * offered the stale, driver-less copy beside the real `hc-sr04`, so placing the
 * sensor still prompted for no `hcsr04` driver.
 *
 * Only an untouched seeder-written copy is pruned; an edited one is the user's.
 * Its own file, because `seedStandardLibrary` memoises its first run.
 */

const ROOT = vi.hoisted(
  () => `${(process.env.TMPDIR || '/tmp').replace(/\/$/, '')}/snakie-638-prune-${process.pid}`
)
const USER_DATA = `${ROOT}/userData`
const RESOURCES = `${ROOT}/resources`

vi.mock('electron', () => ({
  app: { getPath: () => USER_DATA, isPackaged: true }
}))

const { seedStandardLibrary } = await import('../src/main/parts/library')

const LIB = 'snakie-standard'
const bundleLib = join(RESOURCES, 'examples', 'parts', LIB)
const localLib = join(USER_DATA, 'parts', LIB)

const partYaml = (id: string, name: string): string =>
  [
    `id: ${id}`,
    `name: ${name}`,
    'version: 0.1.0',
    'headers:',
    '  - edge: bottom',
    '    pins:',
    '      - name: TRIG',
    '        type: io',
    '        number: 1',
    ''
  ].join('\n')

const KEPT = partYaml('hc-sr04', 'HC SR04')
const DROPPED = partYaml('hr-sr04', 'HR SR04')
const EDITED = partYaml('my-sensor', 'My Sensor')
const sha = (t: string): string => createHash('sha256').update(t).digest('hex')

beforeAll(async () => {
  rmSync(ROOT, { recursive: true, force: true })

  // The bundle ships hc-sr04 only — hr-sr04 and my-sensor are gone from it.
  mkdirSync(join(bundleLib, 'hc-sr04'), { recursive: true })
  writeFileSync(join(bundleLib, 'library.yml'), 'id: snakie-standard\nname: Standard\nversion: 2.0.0\n', 'utf-8')
  writeFileSync(join(bundleLib, 'hc-sr04', 'parts.yml'), KEPT, 'utf-8')

  // The install still holds all three: the two dropped ones were seeded by us,
  // but the user has since edited `my-sensor`.
  for (const [folder, text] of [
    ['hc-sr04', KEPT],
    ['hr-sr04', DROPPED],
    ['my-sensor', `${EDITED}mass_g: 4\n`]
  ] as const) {
    mkdirSync(join(localLib, folder), { recursive: true })
    writeFileSync(join(localLib, folder, 'parts.yml'), text, 'utf-8')
  }
  writeFileSync(join(localLib, 'hr-sr04', 'image.jpg'), 'jpeg', 'utf-8')
  writeFileSync(
    join(localLib, '.snakie-seed.json'),
    JSON.stringify({
      version: '1.0.0',
      parts: { 'hc-sr04': sha(KEPT), 'hr-sr04': sha(DROPPED), 'my-sensor': sha(EDITED) }
    }),
    'utf-8'
  )
  ;(process as NodeJS.Process & { resourcesPath: string }).resourcesPath = RESOURCES
  await seedStandardLibrary()
})

afterAll(() => rmSync(ROOT, { recursive: true, force: true }))

describe('syncBundledLibrary prune (#638)', () => {
  it('removes a part the bundle no longer ships, folder and all', () => {
    expect(existsSync(join(localLib, 'hr-sr04'))).toBe(false)
  })

  it('keeps a dropped part the user has edited', () => {
    expect(existsSync(join(localLib, 'my-sensor', 'parts.yml'))).toBe(true)
  })

  it('leaves the parts the bundle still ships alone', () => {
    expect(readFileSync(join(localLib, 'hc-sr04', 'parts.yml'), 'utf-8')).toBe(KEPT)
  })

  it('stops tracking both dropped parts in the seed manifest', () => {
    const manifest = JSON.parse(readFileSync(join(localLib, '.snakie-seed.json'), 'utf-8'))
    expect(Object.keys(manifest.parts)).toEqual(['hc-sr04'])
  })
})
