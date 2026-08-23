import { describe, expect, it } from 'vitest'
import type { FsEntry } from '../src/main/fs/types'
import {
  EMPTY_SCAN,
  MAX_SCAN_FILES,
  bufferSources,
  findSpriteUses,
  isPythonFile,
  isSkippedDir,
  mergeUsageSources,
  scanProjectFiles,
  sourceDir,
  usageReport,
  type OpenBuffer,
  type ScanFs,
  type UsageSource
} from '../src/renderer/src/components/sprite-usage'

/**
 * The "used in" back-link's logic (#792): which files reference a sprite, what
 * the answer SAYS when none do, and what the project walk is allowed to read.
 *
 * The reference rule itself is `sprite-refs.ts` (phase 1) and is tested there —
 * these tests are about the reverse direction, and about the two things the
 * issue asked to be decided out loud: what the scan covers, and whether an
 * unsaved buffer counts.
 */

/** A disk source, spelled out. */
const src = (path: string, text: string): UsageSource => ({
  path,
  name: path.split('/').pop() ?? path,
  dir: sourceDir(path),
  text
})

describe('where a file sits', () => {
  it('gives the folder a relative reference resolves against', () => {
    expect(sourceDir('/proj/sprites/play.py')).toBe('/proj/sprites')
    expect(sourceDir('C:\\proj\\play.py')).toBe('C:\\proj')
  })

  it('keeps the separator for a file at a root, so the join stays rooted', () => {
    // The bare head is '' (or 'C:'), which would join as a RELATIVE path and
    // silently resolve the sprite somewhere else entirely.
    expect(sourceDir('/main.py')).toBe('/')
    expect(sourceDir('C:\\main.py')).toBe('C:\\')
  })

  it('has no folder for an unsaved untitled buffer', () => {
    expect(sourceDir('untitled-1.py')).toBeNull()
  })
})

describe('what the scan is willing to read', () => {
  it('reads Python only — the reference rule is a Python string scanner', () => {
    expect(isPythonFile('main.py')).toBe(true)
    expect(isPythonFile('MAIN.PY')).toBe(true)
    expect(isPythonFile('robot.yml')).toBe(false)
    expect(isPythonFile('eyes.spr')).toBe(false)
  })

  it('never enters a dependency, cache or dot directory', () => {
    for (const name of ['node_modules', '__pycache__', '.git', '.venv', 'dist', 'build']) {
      expect(isSkippedDir(name), name).toBe(true)
    }
    expect(isSkippedDir('sprites')).toBe(false)
    expect(isSkippedDir('src')).toBe(false)
  })
})

describe('which files use a sprite', () => {
  it('counts a reference that resolves to this exact sprite, and no other', () => {
    const uses = findSpriteUses('/proj/eyes.spr', [
      src('/proj/play.py', 'SPR = "eyes.spr"\n'),
      src('/proj/other.py', 'SPR = "mouth.spr"\n')
    ])
    expect(uses.map((u) => [u.name, u.line])).toEqual([['play.py', 1]])
  })

  it('follows the phase-1 rule rather than a substring match', () => {
    // Comments, docstrings, templates and globs mention a sprite; they do not
    // USE one. If this drifts from `sprite-refs.ts`, the rule lives twice.
    const uses = findSpriteUses('/proj/eyes.spr', [
      src(
        '/proj/play.py',
        [
          '# eyes.spr is the good one',
          '"""a docstring naming eyes.spr"""',
          'a = f"{stem}.spr"',
          'b = "eyes.spr"'
        ].join('\n')
      )
    ])
    expect(uses).toHaveLength(1)
    expect(uses[0].line).toBe(4)
  })

  it('resolves a relative name against the project root as well as the folder', () => {
    const uses = findSpriteUses(
      '/proj/art/eyes.spr',
      [src('/proj/code/play.py', 'SPR = "art/eyes.spr"\n')],
      { projectRoot: '/proj' }
    )
    expect(uses).toHaveLength(1)
    expect(uses[0].text).toBe('art/eyes.spr')
  })

  it('lets a nearer sprite shadow the project root copy', () => {
    // `sprites/play.py` naming "eyes.spr" means `sprites/eyes.spr`. The root's
    // namesake must not collect that use — an over-count is what turns
    // "nothing references it" into a lie the next time you ask.
    const source = src('/proj/sprites/play.py', 'SPR = "eyes.spr"\n')
    const scope = { projectRoot: '/proj', spritesOnDisk: ['/proj/eyes.spr', '/proj/sprites/eyes.spr'] }
    expect(findSpriteUses('/proj/sprites/eyes.spr', [source], scope)).toHaveLength(1)
    expect(findSpriteUses('/proj/eyes.spr', [source], scope)).toHaveLength(0)
  })

  it('falls back to the root when the nearer candidate does not exist', () => {
    const source = src('/proj/sprites/play.py', 'SPR = "eyes.spr"\n')
    const scope = { projectRoot: '/proj', spritesOnDisk: ['/proj/eyes.spr'] }
    expect(findSpriteUses('/proj/eyes.spr', [source], scope)).toHaveLength(1)
  })

  it('reports every distinct line, deduped per line', () => {
    const uses = findSpriteUses('/proj/eyes.spr', [
      src('/proj/play.py', 'a = "eyes.spr"\nb = ("eyes.spr", "eyes.spr")\nc = "eyes.spr"\n')
    ])
    expect(uses.map((u) => u.line)).toEqual([1, 2, 3])
  })

  it('sorts by file then line, so the list does not reshuffle between scans', () => {
    const uses = findSpriteUses('/proj/eyes.spr', [
      src('/proj/z.py', '\n\nx = "eyes.spr"\n'),
      src('/proj/a.py', 'x = "eyes.spr"\n\ny = "eyes.spr"\n')
    ])
    expect(uses.map((u) => `${u.name}:${u.line}`)).toEqual(['a.py:1', 'a.py:3', 'z.py:3'])
  })

  it('carries the column and the literal as written, for the jump and the label', () => {
    const [use] = findSpriteUses('/proj/art/eyes.spr', [
      src('/proj/play.py', 'SPR = "art/eyes.spr"\n')
    ])
    expect(use.column).toBe(7)
    expect(use.text).toBe('art/eyes.spr')
  })

  it('invents nothing for a sprite that has no file yet', () => {
    // A draft has a NAME but no path; matching on the name would report uses of
    // somebody else's `eyes.spr`.
    expect(findSpriteUses('', [src('/proj/play.py', 'SPR = "eyes.spr"\n')])).toEqual([])
  })
})

describe('open buffers as sources', () => {
  const buffer = (over: Partial<OpenBuffer>): OpenBuffer => ({
    id: 'local:/proj/play.py',
    source: 'local',
    path: '/proj/play.py',
    name: 'play.py',
    content: '',
    dirty: false,
    ...over
  })

  it('takes local Python buffers, with their id so a click can activate them', () => {
    const [source] = bufferSources([buffer({ content: 'x = "eyes.spr"' })])
    expect(source.id).toBe('local:/proj/play.py')
    expect(source.dir).toBe('/proj')
  })

  it('drops device buffers — a board file resolves its sprite in flash', () => {
    expect(
      bufferSources([buffer({ source: 'device', path: '/main.py', name: 'main.py', id: 'device:/main.py' })])
    ).toEqual([])
  })

  it('drops non-Python buffers', () => {
    expect(bufferSources([buffer({ name: 'robot.yml', path: '/proj/robot.yml' })])).toEqual([])
  })

  it('keeps an untitled buffer, with no folder to resolve against', () => {
    const [source] = bufferSources([
      buffer({ id: 'local:untitled-1', path: '', name: 'untitled-1.py', content: 'x = "eyes.spr"' })
    ])
    expect(source.path).toBe('')
    expect(source.dir).toBeNull()
  })
})

describe('unsaved edits beat disk', () => {
  const disk = [src('/proj/play.py', 'x = "eyes.spr"\n'), src('/proj/keep.py', 'y = 1\n')]

  it('counts a reference typed but not yet saved', () => {
    const buffers = bufferSources([
      {
        id: 'local:/proj/keep.py',
        source: 'local',
        path: '/proj/keep.py',
        name: 'keep.py',
        content: 'y = "eyes.spr"\n',
        dirty: true
      }
    ])
    const uses = findSpriteUses('/proj/eyes.spr', mergeUsageSources(disk, buffers))
    expect(uses.map((u) => u.name)).toEqual(['keep.py', 'play.py'])
    expect(uses[0].dirty).toBe(true)
  })

  it('stops counting a reference deleted in the buffer but still on disk', () => {
    const buffers = bufferSources([
      {
        id: 'local:/proj/play.py',
        source: 'local',
        path: '/proj/play.py',
        name: 'play.py',
        content: '# removed\n',
        dirty: true
      }
    ])
    expect(findSpriteUses('/proj/eyes.spr', mergeUsageSources(disk, buffers))).toEqual([])
  })

  it('replaces the disk copy in place and appends buffers with no file yet', () => {
    const buffers: UsageSource[] = [
      { path: '/proj/play.py', name: 'play.py', dir: '/proj', text: 'new', dirty: true },
      { path: '', name: 'untitled-1.py', dir: null, text: 'fresh', id: 'local:untitled-1' }
    ]
    const merged = mergeUsageSources(disk, buffers)
    expect(merged.map((s) => s.name)).toEqual(['play.py', 'keep.py', 'untitled-1.py'])
    expect(merged[0].text).toBe('new')
    // Each file appears once — a stale disk copy alongside its buffer would
    // report the same use twice.
    expect(new Set(merged.map((s) => s.name)).size).toBe(merged.length)
  })
})

describe('what the line says', () => {
  const use = { path: '/proj/play.py', name: 'play.py', line: 3, column: 7, text: 'eyes.spr', dirty: false }

  it('always says something — no state renders a blank line', () => {
    const states = [
      usageReport({ spritePath: null, searching: false, scanned: 0, uses: [] }),
      usageReport({ spritePath: '/proj/eyes.spr', searching: true, scanned: 0, uses: [] }),
      usageReport({ spritePath: '/proj/eyes.spr', searching: false, scanned: 0, uses: [] }),
      usageReport({ spritePath: '/proj/eyes.spr', searching: false, scanned: 9, uses: [] }),
      usageReport({ spritePath: '/proj/eyes.spr', searching: false, scanned: 9, uses: [use] })
    ]
    expect(new Set(states.map((s) => s.status)).size).toBe(states.length)
    for (const state of states) expect(state.message.length).toBeGreaterThan(10)
  })

  it('says plainly that nothing references the sprite, and how hard it looked', () => {
    const report = usageReport({
      spritePath: '/proj/eyes.spr',
      searching: false,
      scanned: 12,
      uses: []
    })
    expect(report.status).toBe('unused')
    expect(report.message).toContain('Nothing references eyes.spr')
    expect(report.message).toContain('12 Python files')
  })

  it('never claims "unused" when it has read nothing', () => {
    // "I found no uses" and "I could not look" are different answers, and only
    // one of them means the sprite is safe to delete.
    const report = usageReport({ spritePath: '/proj/eyes.spr', searching: false, scanned: 0, uses: [] })
    expect(report.status).toBe('nowhere')
    expect(report.message).not.toContain('Nothing references')
    // …and it says WHICH of the two it is: no folder open, or a folder with no
    // Python in it. "Open the folder your code is in" is nonsense advice when
    // the folder is already open.
    expect(report.message).toContain('open the folder')
    const inProject = usageReport({
      spritePath: '/proj/eyes.spr',
      searching: false,
      scanned: 0,
      projectRoot: '/proj',
      uses: []
    })
    expect(inProject.status).toBe('nowhere')
    expect(inProject.message).not.toContain('open the folder')
  })

  it('never claims anything about a sprite that has no file', () => {
    const report = usageReport({ spritePath: null, searching: false, scanned: 40, uses: [] })
    expect(report.status).toBe('no-file')
    expect(report.message).toContain('Save this sprite')
  })

  it('counts files, and mentions references only when they outnumber the files', () => {
    const one = usageReport({ spritePath: '/proj/eyes.spr', searching: false, scanned: 9, uses: [use] })
    expect(one.message).toBe('eyes.spr is used in 1 file:')
    const twice = usageReport({
      spritePath: '/proj/eyes.spr',
      searching: false,
      scanned: 9,
      uses: [use, { ...use, line: 8 }, { ...use, path: '/proj/b.py', name: 'b.py' }]
    })
    expect(twice.message).toBe('eyes.spr is used in 2 files (3 references):')
  })

  it('admits when the walk stopped at the cap rather than running out of files', () => {
    const report = usageReport({
      spritePath: '/proj/eyes.spr',
      searching: false,
      scanned: MAX_SCAN_FILES,
      truncated: true,
      uses: []
    })
    expect(report.message).toContain(`stopped at ${MAX_SCAN_FILES}`)
  })
})

// ── The walk ────────────────────────────────────────────────────────────────

/** An in-memory tree: path → text for files, path → children for folders. */
function fakeFs(tree: Record<string, string>, failures: Set<string> = new Set()): ScanFs {
  const dirs = new Map<string, Map<string, boolean>>()
  const ensure = (dir: string): Map<string, boolean> => {
    let entry = dirs.get(dir)
    if (!entry) {
      entry = new Map()
      dirs.set(dir, entry)
      const parent = sourceDir(dir)
      if (parent && parent !== dir) ensure(parent).set(dir, true)
    }
    return entry
  }
  for (const path of Object.keys(tree)) {
    const parent = sourceDir(path)
    if (parent) ensure(parent).set(path, false)
  }
  return {
    readDir: async (path: string): Promise<FsEntry[]> => {
      if (failures.has(path)) throw new Error('EACCES')
      const entry = dirs.get(path)
      if (!entry) throw new Error(`ENOENT ${path}`)
      return [...entry].map(([child, isDir]) => ({
        name: child.split('/').pop() ?? child,
        path: child,
        isDir
      }))
    },
    readFile: async (path: string): Promise<string> => {
      if (failures.has(path)) throw new Error('EACCES')
      const text = tree[path]
      if (text === undefined) throw new Error(`ENOENT ${path}`)
      return text
    }
  }
}

describe('scanning the project', () => {
  const tree = {
    '/proj/play.py': 'SPR = "eyes.spr"\n',
    '/proj/eyes.spr': 'binary',
    '/proj/sprites/mouth.spr': 'binary',
    '/proj/sprites/show.py': 'x = "mouth.spr"\n',
    '/proj/notes.md': 'eyes.spr',
    '/proj/node_modules/pkg/thing.py': 'x = "eyes.spr"\n',
    '/proj/.venv/lib/dep.py': 'x = "eyes.spr"\n',
    '/proj/__pycache__/play.py': 'x = "eyes.spr"\n'
  }

  it('reads every project .py, however deep, and skips the noise', async () => {
    const scan = await scanProjectFiles('/proj', fakeFs(tree))
    expect(scan.sources.map((s) => s.name).sort()).toEqual(['play.py', 'show.py'])
    expect(scan.truncated).toBe(false)
  })

  it('notes the sprites it passes, so shadowing costs no extra reads', async () => {
    const scan = await scanProjectFiles('/proj', fakeFs(tree))
    expect([...scan.sprites].sort()).toEqual(['/proj/eyes.spr', '/proj/sprites/mouth.spr'])
  })

  it('gives each source the folder its relative references resolve against', async () => {
    const scan = await scanProjectFiles('/proj', fakeFs(tree))
    const show = scan.sources.find((s) => s.name === 'show.py')
    expect(show?.dir).toBe('/proj/sprites')
    // …and the whole point: that folder decides which sprite it means.
    expect(findSpriteUses('/proj/sprites/mouth.spr', scan.sources, {
      projectRoot: '/proj',
      spritesOnDisk: scan.sprites
    })).toHaveLength(1)
  })

  it('skips an unreadable folder or file instead of failing the whole answer', async () => {
    const fs = fakeFs(tree, new Set(['/proj/sprites', '/proj/play.py']))
    const scan = await scanProjectFiles('/proj', fs)
    expect(scan.sources).toEqual([])
    expect(scan.truncated).toBe(false)
  })

  it('answers nothing, without touching the filesystem, when no folder is open', async () => {
    const fs: ScanFs = {
      readDir: () => Promise.reject(new Error('should not be called')),
      readFile: () => Promise.reject(new Error('should not be called'))
    }
    await expect(scanProjectFiles('', fs)).resolves.toEqual(EMPTY_SCAN)
  })

  it('stops at the file cap and says so', async () => {
    const many: Record<string, string> = {}
    for (let i = 0; i < 20; i++) many[`/proj/f${i}.py`] = 'x = 1\n'
    const scan = await scanProjectFiles('/proj', fakeFs(many), { maxFiles: 5 })
    expect(scan.sources).toHaveLength(5)
    expect(scan.truncated).toBe(true)
  })

  it('stops descending at the depth cap', async () => {
    const scan = await scanProjectFiles('/proj', fakeFs(tree), { maxDepth: 0 })
    expect(scan.sources.map((s) => s.name)).toEqual(['play.py'])
  })

  it('reads the shallow files first, so a capped walk keeps the likely ones', async () => {
    // The subfolder is listed FIRST, so only a breadth-first walk gets to the
    // root's own file before the cap bites.
    const deep: Record<string, string> = {}
    for (let i = 0; i < 10; i++) deep[`/proj/vendor/v${i}.py`] = 'x = 1\n'
    deep['/proj/top.py'] = 'x = 1\n'
    const scan = await scanProjectFiles('/proj', fakeFs(deep), { maxFiles: 1 })
    expect(scan.sources.map((s) => s.name)).toEqual(['top.py'])
  })
})
