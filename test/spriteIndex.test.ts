import { describe, expect, it } from 'vitest'
import {
  SpriteIndex,
  type SpriteIndexEntry,
  type SpriteIndexIo
} from '../src/renderer/src/components/sprite-index'

/**
 * A fake project tree — a map of folder to the names it holds, `dir/` marking a
 * subfolder — plus a count of how many folders were actually read.
 */
function fakeIo(tree: Record<string, string[]>): SpriteIndexIo & { reads: number } {
  const io = {
    reads: 0,
    async readDir(path: string): Promise<SpriteIndexEntry[]> {
      io.reads++
      const names = tree[path]
      if (!names) throw new Error(`ENOENT: ${path}`)
      return names.map((name) => ({
        name: name.replace(/\/$/, ''),
        path: `${path}/${name.replace(/\/$/, '')}`,
        isDir: name.endsWith('/')
      }))
    }
  }
  return io
}

/** An index whose clock we drive, so the TTL is deterministic. */
const indexAt = (
  io: SpriteIndexIo,
  clock: { t: number },
  opts: Record<string, number> = {}
): SpriteIndex => new SpriteIndex(io, { ttlMs: 5000, now: () => clock.t, ...opts })

const project = {
  '/proj': ['main.py', 'eyes.spr', 'src/', 'art/', 'node_modules/', '.git/'],
  '/proj/src': ['play.py', 'mouth.spr'],
  '/proj/art': ['logo.spr', 'notes.txt'],
  '/proj/node_modules': ['junk.spr'],
  '/proj/.git': ['hook.spr']
}

describe('finding the project’s sprites', () => {
  it('walks the folders and reports only the .spr files', async () => {
    const io = fakeIo(project)
    const index = indexAt(io, { t: 0 })
    expect(await index.refresh(['/proj'])).toBe(true)
    expect([...index.list()]).toEqual(['/proj/art/logo.spr', '/proj/eyes.spr', '/proj/src/mouth.spr'])
  })

  it('never looks inside a hidden folder or node_modules', async () => {
    const io = fakeIo(project)
    const index = indexAt(io, { t: 0 })
    await index.refresh(['/proj'])
    expect(index.list().some((p) => p.includes('node_modules') || p.includes('.git'))).toBe(false)
    // Not merely filtered out of the answer — never read at all.
    expect(io.reads).toBe(3)
  })

  it('knows nothing before it is asked, and never reads on the way to answering', () => {
    const io = fakeIo(project)
    const index = indexAt(io, { t: 0 })
    expect(index.list()).toEqual([])
    expect(io.reads).toBe(0) // `list` is what a keystroke calls
  })

  it('costs NOTHING while the snapshot is inside its TTL', async () => {
    const io = fakeIo(project)
    const clock = { t: 0 }
    const index = indexAt(io, clock)
    await index.refresh(['/proj'])
    const after = io.reads

    clock.t = 4999
    expect(index.stale(['/proj'])).toBe(false)
    expect(await index.refresh(['/proj'])).toBe(false)
    expect(io.reads).toBe(after)

    clock.t = 5000
    expect(index.stale(['/proj'])).toBe(true)
    await index.refresh(['/proj'])
    expect(io.reads).toBeGreaterThan(after)
  })

  it('re-walks when the folders themselves change, TTL or not', async () => {
    const io = fakeIo(project)
    const clock = { t: 0 }
    const index = indexAt(io, clock)
    await index.refresh(['/proj'])
    expect(index.stale(['/proj/src', '/proj'])).toBe(true)
    expect(await index.refresh(['/proj/src', '/proj'])).toBe(false) // same files, new folders
    expect(index.stale(['/proj/src', '/proj'])).toBe(false)
  })

  it('reads a folder once even when the search folders nest', async () => {
    const io = fakeIo(project)
    const index = indexAt(io, { t: 0 })
    // The file's own folder is inside the project folder — the usual case.
    await index.refresh(['/proj/src', '/proj'])
    expect(io.reads).toBe(3) // src, proj, art — not src twice
    expect([...index.list()]).toContain('/proj/src/mouth.spr')
  })

  it('shares one walk between concurrent callers', async () => {
    const io = fakeIo(project)
    const index = indexAt(io, { t: 0 })
    const [a, b] = await Promise.all([index.refresh(['/proj']), index.refresh(['/proj'])])
    expect([a, b]).toEqual([true, true])
    expect(io.reads).toBe(3)
  })

  it('keeps answering with the old list while a stale one is re-walked', async () => {
    const io = fakeIo(project)
    const index = indexAt(io, { t: 0 })
    await index.refresh(['/proj'])
    const before = [...index.list()]

    index.invalidate()
    // Invalidation marks it stale — it does NOT empty the popup.
    expect(index.stale(['/proj'])).toBe(true)
    expect([...index.list()]).toEqual(before)
  })

  it('tells subscribers only when the list actually changed', async () => {
    const tree: Record<string, string[]> = { '/proj': ['eyes.spr'] }
    const io = fakeIo(tree)
    const clock = { t: 0 }
    const index = indexAt(io, clock)
    let changes = 0
    index.subscribe(() => changes++)

    await index.refresh(['/proj'])
    expect(changes).toBe(1)

    clock.t += 6000
    await index.refresh(['/proj']) // same files: a walk, but nothing to say
    expect(changes).toBe(1)

    tree['/proj'] = ['eyes.spr', 'mouth.spr']
    clock.t += 6000
    expect(await index.refresh(['/proj'])).toBe(true)
    expect(changes).toBe(2)
    expect([...index.list()]).toEqual(['/proj/eyes.spr', '/proj/mouth.spr'])
  })

  it('survives a folder that cannot be read', async () => {
    const io = fakeIo({ '/proj': ['eyes.spr', 'locked/'] })
    const index = indexAt(io, { t: 0 })
    await index.refresh(['/proj', '/gone'])
    expect([...index.list()]).toEqual(['/proj/eyes.spr'])
  })

  it('ignores a file no literal could ever name', async () => {
    const io = fakeIo({ '/proj': ['eyes.spr', '.spr', '{gen}.spr', 'notes.txt', 'eyes.sprite'] })
    const index = indexAt(io, { t: 0 })
    await index.refresh(['/proj'])
    expect([...index.list()]).toEqual(['/proj/eyes.spr'])
  })

  it('stops descending at the depth limit', async () => {
    const io = fakeIo({
      '/proj': ['a/'],
      '/proj/a': ['b/', 'shallow.spr'],
      '/proj/a/b': ['deep.spr']
    })
    const index = indexAt(io, { t: 0 }, { maxDepth: 1 })
    await index.refresh(['/proj'])
    expect([...index.list()]).toEqual(['/proj/a/shallow.spr'])
  })

  it('is bounded — a runaway tree cannot walk forever', async () => {
    const tree: Record<string, string[]> = {}
    for (let i = 0; i < 50; i++) tree[`/proj${'/d'.repeat(i)}`] = ['d/', `s${i}.spr`]
    const io = fakeIo(tree)
    const index = indexAt(io, { t: 0 }, { maxDirs: 5, maxDepth: 99 })
    await index.refresh(['/proj'])
    expect(io.reads).toBe(5)
    // Breadth-first, so what survives the cap is what is nearest.
    expect([...index.list()]).toEqual([
      '/proj/d/d/d/d/s4.spr',
      '/proj/d/d/d/s3.spr',
      '/proj/d/d/s2.spr',
      '/proj/d/s1.spr',
      '/proj/s0.spr'
    ])
  })
})
