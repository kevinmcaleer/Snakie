import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
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

const { importPartMesh, mirrorPartFolder, readLibraries, writePart } = await import(
  '../src/main/parts/library'
)

const LIB = 'snakie-standard'
const PART = 'guard-widget'
const partsRoot = join(USER_DATA, 'parts')
const partDir = join(partsRoot, LIB, PART)
const ymlPath = join(partDir, 'parts.yml')

/** A Modulino-shaped part: the fields #750 kept reverting are all present. */
function yamlFor(opts: {
  address: number
  height: number
  help?: boolean
  /** A linked 3-D model + its orientation correction (#741). */
  mesh?: string
  meshRotation?: string
}): string {
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
    ...(opts.mesh ? [`mesh: ${opts.mesh}`] : []),
    ...(opts.meshRotation ? [`meshRotation: ${opts.meshRotation}`] : []),
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

/**
 * THE LINKED 3-D MODEL (#741), through the REAL writer on a REAL folder.
 *
 * The Part Editor's 3-D view copies an STL into the part folder and records its
 * filename — which puts the whole feature at the mercy of what a save does to a
 * part folder's other files. #750 deliberately narrowed that pruning to the
 * assets the PREVIOUS `parts.yml` named (image / rear / help) and nothing else;
 * a mesh is deliberately NOT on that list. This asserts the narrowing holds
 * rather than trusting the comment that describes it — `modulino.stl` was
 * deleted from disk once already.
 */
describe('a linked mesh + its orientation, through a real save (#741)', () => {
  const STL = 'solid widget\nfacet normal 0 0 1\nendsolid widget\n'

  beforeEach(() => {
    seedPart(yamlFor({ address: 0x3e, height: 25.36, mesh: 'widget.stl', meshRotation: '[90, 0, -90]' }))
    writeFileSync(join(partDir, 'widget.stl'), STL, 'utf-8')
  })

  it('reads the link and the orientation back off disk', async () => {
    const part = await loadPart()
    expect(part.mesh).toBe('widget.stl')
    expect(part.meshRotation).toEqual([90, 0, -90])
  })

  it('leaves the mesh FILE alone across an ordinary save', async () => {
    const part = await loadPart()
    const res = await writePart(LIB, { ...part, name: 'Guard Widget III' })
    expect(res.ok).toBe(true)
    expect(existsSync(join(partDir, 'widget.stl'))).toBe(true)
    expect(readFileSync(join(partDir, 'widget.stl'), 'utf-8')).toBe(STL)
  })

  it('round-trips the link and the orientation through the writer', async () => {
    const part = await loadPart()
    const res = await writePart(LIB, { ...part, name: 'Guard Widget III' })
    expect(res.ok).toBe(true)
    const yaml = readFileSync(ymlPath, 'utf-8')
    expect(yaml).toContain('mesh: widget.stl')
    expect(yaml).toContain('meshRotation')
    // And back in through the reader, which is what the editor would reopen.
    const again = await loadPart()
    expect(again.mesh).toBe('widget.stl')
    expect(again.meshRotation).toEqual([90, 0, -90])
  })

  it('keeps the file even when the LINK is removed — unlink is not delete', async () => {
    // Deliberately unlike `help.md`, which a save DOES clean up when cleared:
    // Snakie wrote the help file, so it may remove it. The mesh was handed to us
    // by the user, so it is theirs. Unlinking says "this part has no model", not
    // "throw the model away".
    const part = await loadPart()
    const res = await writePart(LIB, { ...part, mesh: undefined, meshRotation: undefined })
    expect(res.ok).toBe(true)
    expect(readFileSync(ymlPath, 'utf-8')).not.toContain('mesh:')
    expect(existsSync(join(partDir, 'widget.stl'))).toBe(true)
  })

  it('survives a save that REPLACES the mesh with a differently-named one', async () => {
    const part = await loadPart()
    writeFileSync(join(partDir, 'widget-2.stl'), 'solid two\nendsolid two\n', 'utf-8')
    const res = await writePart(LIB, { ...part, mesh: 'widget-2.stl' })
    expect(res.ok).toBe(true)
    // The one it stopped pointing at is still there. A save may not delete it.
    expect(existsSync(join(partDir, 'widget.stl'))).toBe(true)
    expect(existsSync(join(partDir, 'widget-2.stl'))).toBe(true)
  })
})

/**
 * THE #787 REGRESSION, through the real writer on a real folder.
 *
 * What actually happened to the 9V battery: it was authored in `my-parts`, its
 * STL was copied into `my-parts/9v-battery/`, and it was then saved into
 * `snakie-standard` — which wrote the `parts.yml` (`mesh:`, `meshRotation:` and
 * all) into `snakie-standard/9v-battery/` and left the 591 KB model behind. The
 * image made the trip because it rides in memory as a data URL; the mesh exists
 * only on disk, so it did not.
 *
 * Every save reported success. Nothing anywhere said the reference now pointed
 * at a file that was not there, which is why finding it took a directory
 * listing.
 *
 * Both halves are asserted: the model FOLLOWS the part, and when it cannot be
 * found the save SAYS SO instead of quietly writing a dangling reference.
 */
describe('a part that changes library takes its 3-D model with it (#787)', () => {
  const FROM = 'my-parts'
  const STL = 'solid battery\nfacet normal 0 0 1\nendsolid battery\n'
  const fromDir = join(partsRoot, FROM, PART)

  beforeEach(() => {
    // The part as it sits in the library it was authored in.
    mkdirSync(fromDir, { recursive: true })
    writeFileSync(
      join(fromDir, 'parts.yml'),
      yamlFor({ address: 0x3e, height: 48.5, mesh: 'battery-9v.stl', meshRotation: '[0, 0, 90]' }),
      'utf-8'
    )
    writeFileSync(join(fromDir, 'battery-9v.stl'), STL, 'utf-8')
    rmSync(partDir, { recursive: true, force: true })
  })

  it('carries the model into the library it is saved to', async () => {
    const opened = (await readLibraries())
      .find((l) => l.id === FROM)
      ?.parts?.find((p) => p.id === PART)
    expect(opened?.mesh).toBe('battery-9v.stl')

    const res = await writePart(LIB, opened!, { assetsFrom: { libraryId: FROM } })
    expect(res.ok).toBe(true)
    // THE BUG: this file used to be absent, and nothing said so.
    expect(existsSync(join(partDir, 'battery-9v.stl'))).toBe(true)
    expect(readFileSync(join(partDir, 'battery-9v.stl'), 'utf-8')).toBe(STL)
    expect(res.missingMesh).toBeUndefined()
  })

  it('leaves the original where it was — a move is a copy, not a cut', async () => {
    const opened = (await readLibraries())
      .find((l) => l.id === FROM)
      ?.parts?.find((p) => p.id === PART)
    await writePart(LIB, opened!, { assetsFrom: { libraryId: FROM } })
    // #750's rule reaches this too: the source folder is not ours to empty.
    expect(existsSync(join(fromDir, 'battery-9v.stl'))).toBe(true)
  })

  it('never overwrites a same-named model already in the destination', async () => {
    const theirs = 'solid THEIRS\nendsolid THEIRS\n'
    mkdirSync(partDir, { recursive: true })
    writeFileSync(join(partDir, 'battery-9v.stl'), theirs, 'utf-8')
    const opened = (await readLibraries())
      .find((l) => l.id === FROM)
      ?.parts?.find((p) => p.id === PART)
    const res = await writePart(LIB, opened!, { assetsFrom: { libraryId: FROM } })
    expect(res.ok).toBe(true)
    expect(readFileSync(join(partDir, 'battery-9v.stl'), 'utf-8')).toBe(theirs)
  })

  it('SAYS SO when the model cannot be found — a save must not write a dangling link', async () => {
    // The exact end state #787 reported: a `mesh:` with no file behind it.
    rmSync(join(fromDir, 'battery-9v.stl'), { force: true })
    const opened = (await readLibraries())
      .find((l) => l.id === FROM)
      ?.parts?.find((p) => p.id === PART)
    const res = await writePart(LIB, opened!, { assetsFrom: { libraryId: FROM } })
    // The write itself is fine — parts.yml is on disk and correct.
    expect(res.ok).toBe(true)
    // But the one thing it could not make true is reported, by name.
    expect(res.missingMesh).toBe('battery-9v.stl')
  })

  it('carries the model when the part is RENAMED, not moved', async () => {
    // The other half of the same class: either half of `<lib>/<part>` can change
    // under a part, and both send the save to a folder the model isn't in.
    const opened = (await readLibraries())
      .find((l) => l.id === FROM)
      ?.parts?.find((p) => p.id === PART)
    const renamed = join(partsRoot, FROM, 'pp3-battery')
    const res = await writePart(
      FROM,
      { ...opened!, id: 'pp3-battery', sourceHash: undefined },
      { assetsFrom: { libraryId: FROM, partId: PART } }
    )
    expect(res.ok).toBe(true)
    expect(existsSync(join(renamed, 'battery-9v.stl'))).toBe(true)
    expect(res.missingMesh).toBeUndefined()
  })

  it('says nothing about a part that has no model at all', async () => {
    const opened = (await readLibraries())
      .find((l) => l.id === FROM)
      ?.parts?.find((p) => p.id === PART)
    const res = await writePart(LIB, { ...opened!, mesh: undefined }, { assetsFrom: { libraryId: FROM } })
    expect(res.ok).toBe(true)
    expect(res.missingMesh).toBeUndefined()
  })

  it('refuses to satisfy a reference that escapes the part folder', async () => {
    const opened = (await readLibraries())
      .find((l) => l.id === FROM)
      ?.parts?.find((p) => p.id === PART)
    const res = await writePart(LIB, { ...opened!, mesh: '../../../etc/passwd' }, { assetsFrom: { libraryId: FROM } })
    expect(res.ok).toBe(true)
    expect(res.missingMesh).toBe('../../../etc/passwd')
    expect(existsSync(join(partsRoot, LIB, 'passwd'))).toBe(false)
  })
})

describe('importPartMesh — copying a chosen model into the part folder (#741)', () => {
  const source = join(USER_DATA, 'downloads', 'Battery 9V.stl')
  const other = join(USER_DATA, 'downloads', 'battery-9v.stl')

  beforeEach(() => {
    mkdirSync(join(USER_DATA, 'downloads'), { recursive: true })
    writeFileSync(source, 'solid battery\nendsolid battery\n', 'utf-8')
    writeFileSync(other, 'solid OTHER\nendsolid OTHER\n', 'utf-8')
  })

  it('copies the file in under a safe name, and the part folder now holds it', async () => {
    const res = await importPartMesh(LIB, PART, source)
    expect(res.ok).toBe(true)
    // The copy IS the feature: hand-copying is what this replaces.
    expect(res.filename).toBe('battery-9v.stl')
    expect(readFileSync(join(partDir, 'battery-9v.stl'), 'utf-8')).toBe(
      readFileSync(source, 'utf-8')
    )
  })

  it('re-linking the SAME file copies nothing and litters nothing', async () => {
    const first = await importPartMesh(LIB, PART, source)
    const again = await importPartMesh(LIB, PART, source)
    expect(again.filename).toBe(first.filename)
    expect(again.reused).toBe(true)
    expect(readdirSync(partDir).filter((n) => n.endsWith('.stl'))).toEqual(['battery-9v.stl'])
  })

  it('never overwrites a file it did not author — a clash takes the next name', async () => {
    const before = 'solid HAND PLACED\nendsolid HAND PLACED\n'
    writeFileSync(join(partDir, 'battery-9v.stl'), before, 'utf-8')
    const res = await importPartMesh(LIB, PART, source)
    expect(res.ok).toBe(true)
    expect(res.filename).toBe('battery-9v-2.stl')
    // The pre-existing file is untouched — this is the #750 rule, on the way IN.
    expect(readFileSync(join(partDir, 'battery-9v.stl'), 'utf-8')).toBe(before)
  })

  it('DOES overwrite the model this part already references (that is Replace)', async () => {
    writeFileSync(join(partDir, 'battery-9v.stl'), 'solid OLD\nendsolid OLD\n', 'utf-8')
    const res = await importPartMesh(LIB, PART, other, 'battery-9v.stl')
    expect(res.ok).toBe(true)
    expect(res.filename).toBe('battery-9v.stl')
    expect(readFileSync(join(partDir, 'battery-9v.stl'), 'utf-8')).toBe(readFileSync(other, 'utf-8'))
  })

  it('refuses a file it could never render', async () => {
    const notMesh = join(USER_DATA, 'downloads', 'notes.txt')
    writeFileSync(notMesh, 'hello', 'utf-8')
    const res = await importPartMesh(LIB, PART, notMesh)
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/\.stl/i)
  })

  it('refuses a part with no id rather than writing into a nameless folder', async () => {
    const res = await importPartMesh(LIB, '', source)
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/id/i)
  })

  it('lands inside the part folder and nowhere else, whatever the source is called', async () => {
    const nasty = join(USER_DATA, 'downloads', 'evil.stl')
    writeFileSync(nasty, 'solid evil\nendsolid evil\n', 'utf-8')
    const res = await importPartMesh(LIB, PART, nasty)
    expect(res.ok).toBe(true)
    expect(res.filename).not.toMatch(/[/\\]/)
    expect(existsSync(join(partDir, res.filename!))).toBe(true)
  })

  it('creates the part folder for a part that has not been saved yet', async () => {
    const fresh = 'never-saved'
    const res = await importPartMesh(LIB, fresh, source)
    expect(res.ok).toBe(true)
    expect(existsSync(join(partsRoot, LIB, fresh, res.filename!))).toBe(true)
  })

  /**
   * #787 fault 2: the 9V battery saved `mesh:` and `meshRotation:` but no
   * `meshUnits:`. An `.stl` states no units, so the link step is the last moment
   * anything can look at the geometry — after it, the size is a guess every
   * consumer re-makes for itself.
   */
  it('measures the model as it copies it, so the caller can record meshUnits', async () => {
    const mm = join(USER_DATA, 'downloads', 'in-mm.stl')
    writeFileSync(
      mm,
      [
        'solid mm',
        'facet normal 0 0 1 outer loop',
        'vertex 0 0 0',
        'vertex 26.5 0 0',
        'vertex 0 48.5 0',
        'endloop endfacet',
        'endsolid mm'
      ].join('\n'),
      'utf-8'
    )
    const res = await importPartMesh(LIB, 'measured-part', mm)
    expect(res.ok).toBe(true)
    expect(res.maxDim).toBeCloseTo(48.5, 6)
  })

  it('measures a re-used file too — the answer must not depend on copying', async () => {
    const first = await importPartMesh(LIB, 'reuse-part', source)
    const again = await importPartMesh(LIB, 'reuse-part', source)
    expect(again.reused).toBe(true)
    expect(again.maxDim).toEqual(first.maxDim)
  })

  it('declines to measure what it cannot parse, rather than inventing a size', async () => {
    const dae = join(USER_DATA, 'downloads', 'model.dae')
    writeFileSync(dae, '<COLLADA/>', 'utf-8')
    const res = await importPartMesh(LIB, 'dae-part', dae)
    expect(res.ok).toBe(true)
    expect(res.maxDim).toBeUndefined()
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
