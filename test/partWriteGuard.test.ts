import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'

/**
 * #750 — a running Snakie must never silently overwrite an external edit to a
 * part's `parts.yml`, and must never delete files it did not author.
 *
 * This exercises the REAL writer (`src/main/parts/library.ts`) against a real
 * temp `userData` tree, because that is where the damage happened: the parts
 * library was corrupted four times in one session by the app serialising a
 * stale in-memory `PartDefinition` over a file that had changed underneath it,
 * and by the dev userData→repo mirror `rm -rf`-ing a part folder to match its
 * own idea of the part's contents.
 *
 * `library.ts` reads `<userData>/parts` through Electron's `app.getPath`, so the
 * only thing mocked is that one path — everything else (read, YAML, write,
 * asset handling, the mirror) is the shipping code.
 */

/** A temp userData root. `vi.hoisted` so the `electron` mock factory — which is
 *  hoisted above the imports — can close over a value that already exists. */
const USER_DATA = vi.hoisted(
  () => `${(process.env.TMPDIR || '/tmp').replace(/\/$/, '')}/snakie-750-${process.pid}`
)

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => (name === 'userData' ? USER_DATA : USER_DATA),
    // Packaged, so nothing in this test can reach the repo's own examples/parts.
    isPackaged: true
  }
}))

const { mirrorPartFolder, readLibraries, writePart } = await import('../src/main/parts/library')

const LIB = 'snakie-standard'
const PART = 'guard-widget'
const partsRoot = join(USER_DATA, 'parts')
const partDir = join(partsRoot, LIB, PART)
const ymlPath = join(partDir, 'parts.yml')

/** A Modulino-shaped part: the fields #750 kept reverting are all present. */
function yamlFor(opts: { address: number; height: number; help?: boolean }): string {
  return [
    `id: ${PART}`,
    'name: Guard Widget',
    'version: 0.1.0',
    'dimensions:',
    '  width: 41',
    `  height: ${opts.height}`,
    'i2cAddresses:',
    `  - ${opts.address}`,
    ...(opts.help ? ['help: help.md'] : []),
    'headers:',
    '  - edge: bottom',
    '    pins:',
    '      - name: SDA',
    '        type: io',
    '        number: 1',
    '      - name: GND',
    '        type: gnd',
    '        number: 2',
    ''
  ].join('\n')
}

/** The value the app has in memory (the pre-fix, 8-bit-shifted address). */
const STALE = yamlFor({ address: 0x7c, height: 23.56 })
/** What a script / editor / `git checkout` puts on disk while the app runs. */
const CORRECTED = yamlFor({ address: 0x3e, height: 25.36 })

function seedPart(yaml: string): void {
  rmSync(partsRoot, { recursive: true, force: true })
  mkdirSync(partDir, { recursive: true })
  writeFileSync(ymlPath, yaml, 'utf-8')
}

async function loadPart(): Promise<import('../src/shared/part').PartDefinition> {
  const libs = await readLibraries()
  const part = libs.find((l) => l.id === LIB)?.parts.find((p) => p.id === PART)
  if (!part) throw new Error('fixture part did not load')
  return part
}

beforeEach(() => seedPart(STALE))
afterAll(() => rmSync(USER_DATA, { recursive: true, force: true }))

describe('writePart — a stale save cannot clobber an external edit (#750)', () => {
  it('refuses the write and leaves the corrected file exactly as it found it', async () => {
    // 1) The app loads the library. THIS object is the renderer's in-memory copy.
    const inMemory = await loadPart()
    expect(inMemory.i2cAddresses).toEqual([0x7c])

    // 2) An external tool corrects the hardware truth while the app runs.
    writeFileSync(ymlPath, CORRECTED, 'utf-8')

    // 3) The app saves its now-stale copy (the Part Editor's Save, an unrelated
    //    edit, a duplicate — any path that reaches writePart).
    const res = await writePart(LIB, { ...inMemory })

    // The damage, named first: a save must never silently destroy data it did
    // not author. Before the fix this line read back the 8-bit address and the
    // wrong board height — the exact revert #750 records, four times over.
    expect(readFileSync(ymlPath, 'utf-8')).toBe(CORRECTED)
    expect(res.ok).toBe(false)
    expect(res.conflict).toBe(true)
    expect(res.error).toMatch(/changed on disk/i)
  })

  it('still writes when the file has not moved under it', async () => {
    const part = await loadPart()
    const res = await writePart(LIB, { ...part, name: 'Guard Widget II' })
    expect(res.ok).toBe(true)
    expect(readFileSync(ymlPath, 'utf-8')).toContain('Guard Widget II')
  })

  it('hands back a fresh stamp, so a second save in the same session works', async () => {
    const part = await loadPart()
    const first = await writePart(LIB, { ...part, name: 'One' })
    expect(first.ok).toBe(true)
    expect(first.sourceHash).toBeTruthy()
    // Without the new stamp the editor's next save would look stale to itself.
    const second = await writePart(LIB, { ...part, name: 'Two', sourceHash: first.sourceHash })
    expect(second.ok).toBe(true)
    expect(readFileSync(ymlPath, 'utf-8')).toContain('Two')
  })

  it('writes a brand-new part that has no file to conflict with', async () => {
    const part = await loadPart()
    const res = await writePart(LIB, { ...part, id: 'guard-widget-copy', sourceHash: undefined })
    expect(res.ok).toBe(true)
    expect(existsSync(join(partsRoot, LIB, 'guard-widget-copy', 'parts.yml'))).toBe(true)
  })

  it('refuses to overwrite a part it never read (no stamp, file present)', async () => {
    const part = await loadPart()
    const res = await writePart(LIB, { ...part, sourceHash: undefined })
    expect(res.ok).toBe(false)
    expect(readFileSync(ymlPath, 'utf-8')).toBe(STALE)
  })
})

describe('writePart — sibling files a part did not author (#750)', () => {
  it('leaves an unreferenced help.md alone', async () => {
    // `parts.yml` does NOT reference help.md — so the file is not the part's to
    // delete. (modulino-led-matrix/help.md was removed from disk exactly here.)
    writeFileSync(join(partDir, 'help.md'), '# hand-written help\n', 'utf-8')
    const part = await loadPart()
    expect(part.helpText).toBeUndefined()

    const res = await writePart(LIB, { ...part })
    expect(res.ok).toBe(true)
    expect(existsSync(join(partDir, 'help.md'))).toBe(true)
  })

  it('leaves an image asset it did not write alone', async () => {
    // A hand-placed `image.png` with no `image:` key in parts.yml: the blanket
    // "remove every image.<ext>" sweep used to delete it on an unrelated save.
    writeFileSync(join(partDir, 'image.png'), 'not-really-a-png', 'utf-8')
    const part = await loadPart()
    const res = await writePart(LIB, { ...part })
    expect(res.ok).toBe(true)
    expect(existsSync(join(partDir, 'image.png'))).toBe(true)
  })

  it('leaves a mesh / datasheet / anything else beside parts.yml alone', async () => {
    writeFileSync(join(partDir, 'modulino.stl'), 'solid modulino\nendsolid\n', 'utf-8')
    const part = await loadPart()
    const res = await writePart(LIB, { ...part })
    expect(res.ok).toBe(true)
    expect(existsSync(join(partDir, 'modulino.stl'))).toBe(true)
  })

  it('still removes the help file it DID author when the help is cleared', async () => {
    seedPart(yamlFor({ address: 0x3e, height: 25.36, help: true }))
    writeFileSync(join(partDir, 'help.md'), '# authored\n', 'utf-8')
    const part = await loadPart()
    expect(part.helpText).toBe('# authored\n')

    const res = await writePart(LIB, { ...part, helpText: undefined })
    expect(res.ok).toBe(true)
    expect(existsSync(join(partDir, 'help.md'))).toBe(false)
    expect(readFileSync(ymlPath, 'utf-8')).not.toContain('help:')
  })
})

describe('mirrorPartFolder — the dev userData→repo mirror (#750)', () => {
  const src = join(USER_DATA, 'mirror-src')
  const dest = join(USER_DATA, 'mirror-dest')

  beforeEach(() => {
    rmSync(src, { recursive: true, force: true })
    rmSync(dest, { recursive: true, force: true })
    mkdirSync(src, { recursive: true })
    mkdirSync(dest, { recursive: true })
    writeFileSync(join(src, 'parts.yml'), STALE, 'utf-8')
    // The repo copy carries assets the runtime copy has never had.
    writeFileSync(join(dest, 'parts.yml'), CORRECTED, 'utf-8')
    writeFileSync(join(dest, 'help.md'), '# the repo help\n', 'utf-8')
    writeFileSync(join(dest, 'modulino.stl'), 'solid modulino\n', 'utf-8')
  })

  it('does not delete repo files the runtime copy knows nothing about', async () => {
    await mirrorPartFolder(src, dest)
    // These two were deleted from disk by the `rm -rf` this replaced.
    expect(existsSync(join(dest, 'help.md'))).toBe(true)
    expect(existsSync(join(dest, 'modulino.stl'))).toBe(true)
    expect(readFileSync(join(dest, 'parts.yml'), 'utf-8')).toBe(STALE)
  })

  it('refuses when the destination carries a NEWER version than the source', async () => {
    writeFileSync(join(dest, 'parts.yml'), CORRECTED.replace('version: 0.1.0', 'version: 0.1.8'), 'utf-8')
    await expect(mirrorPartFolder(src, dest)).rejects.toThrow(/newer/i)
    expect(readFileSync(join(dest, 'parts.yml'), 'utf-8')).toContain('version: 0.1.8')
  })
})
