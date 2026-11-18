import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  buildSnapshot,
  clearSnapshot,
  findSnapshot,
  maxUntitledNumber,
  readSnapshot,
  restorePlan,
  writeSnapshot,
  SNAPSHOT_KEY,
  SNAPSHOT_MAX_AGE_MS,
  type SnapshotFile
} from '../src/renderer/src/store/reload-snapshot'
import {
  applyUpdateKeepingWork,
  saveWorkForReload,
  setUnsavedWorkProbe,
  setWorkSaver
} from '../src/renderer/src/lib/unsaved-work'
import { BOOT_GRACE_MS, shouldApplyQuietly } from '../src/renderer/src/web/web-updates'

/**
 * A new version is SUGGESTED, and taking it loses nothing: every open tab —
 * unsaved edits, untitled buffers, board files — is snapshotted before the
 * reload/restart and rebuilt on the next boot (BetterCad's "autosave, then
 * reload" behaviour, for Snakie).
 */

const mem = (seed: Record<string, string> = {}) => {
  const store: Record<string, string> = { ...seed }
  return {
    store,
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => {
      store[k] = v
    },
    removeItem: (k: string) => {
      delete store[k]
    }
  }
}

const file = (over: Partial<SnapshotFile>): SnapshotFile => ({
  id: 'local:/a.py',
  source: 'local',
  path: '/a.py',
  name: 'a.py',
  content: 'print(1)',
  dirty: false,
  ...over
})

const NOW = 1_700_000_000_000

describe('building the snapshot', () => {
  it('keeps every tab in order, with its content and dirty flag', () => {
    const files = [
      file({}),
      file({ id: 'local:untitled-3', path: '', name: 'untitled-3.py', content: 'x = 1', dirty: true }),
      file({ id: 'device:/main.py', source: 'device', path: '/main.py', name: 'main.py', dirty: true })
    ]
    const snap = buildSnapshot(files, 'local:untitled-3', NOW)
    expect(snap.files.map((f) => f.id)).toEqual(files.map((f) => f.id))
    expect(snap.files[1]).toMatchObject({ content: 'x = 1', dirty: true })
    expect(snap.activeId).toBe('local:untitled-3')
    expect(snap.savedAt).toBe(NOW)
  })

  it("never carries a .mpy's placeholder buffer as content (#964)", () => {
    const snap = buildSnapshot([file({ path: '/lib.mpy', binary: true, content: 'junk', dirty: true })], null, NOW)
    expect(snap.files[0]).toMatchObject({ content: '', dirty: false, binary: true })
  })
})

describe('writing and reading it back', () => {
  it('round-trips', () => {
    const s = mem()
    const snap = buildSnapshot([file({ dirty: true, content: 'edited' })], 'local:/a.py', NOW)
    expect(writeSnapshot(s, snap)).toBe(true)
    expect(readSnapshot(s, NOW + 1000)).toEqual(snap)
  })

  it('reports a failed write, so the caller does not reload over unsaved work', () => {
    const full = {
      ...mem(),
      setItem: () => {
        throw new Error('QuotaExceededError')
      }
    }
    expect(writeSnapshot(full, buildSnapshot([file({})], null, NOW))).toBe(false)
    // and a storage that swallows the write silently
    const blackHole = { ...mem(), setItem: () => undefined }
    expect(writeSnapshot(blackHole, buildSnapshot([file({})], null, NOW))).toBe(false)
  })

  it('ignores a stale snapshot — the restart never happened', () => {
    const s = mem()
    writeSnapshot(s, buildSnapshot([file({ dirty: true })], null, NOW))
    expect(readSnapshot(s, NOW + SNAPSHOT_MAX_AGE_MS + 1)).toBeNull()
  })

  it('ignores corrupt data and malformed tabs', () => {
    expect(readSnapshot(mem({ [SNAPSHOT_KEY]: '{nope' }), NOW)).toBeNull()
    const s = mem({
      [SNAPSHOT_KEY]: JSON.stringify({ savedAt: NOW, activeId: null, files: [file({}), { id: 3 }] })
    })
    expect(readSnapshot(s, NOW)?.files).toHaveLength(1)
  })

  it('finds it in whichever storage has it, and clears it from all', () => {
    const session = mem()
    const local = mem()
    writeSnapshot(local, buildSnapshot([file({})], null, NOW))
    expect(findSnapshot([null, session, local], NOW)?.files).toHaveLength(1)
    clearSnapshot([session, local])
    expect(findSnapshot([session, local], NOW)).toBeNull()
  })
})

describe('restoring it', () => {
  it('reopens clean local files from disk, rebuilds everything else from the copy', () => {
    expect(restorePlan(file({}))).toBe('reopen')
    expect(restorePlan(file({ path: '/x.mpy', binary: true }))).toBe('reopen')
    expect(restorePlan(file({ dirty: true }))).toBe('buffer')
    expect(restorePlan(file({ id: 'local:untitled-1', path: '' }))).toBe('buffer')
    expect(restorePlan(file({ source: 'device', id: 'device:/a.py' }))).toBe('buffer')
  })

  it('moves the untitled counter past restored buffers', () => {
    expect(
      maxUntitledNumber([file({ id: 'local:untitled-2' }), file({ id: 'local:untitled-7' }), file({})])
    ).toBe(7)
  })

  it('is wired into the workspace boot and the saver seam', () => {
    const ws = readFileSync('src/renderer/src/store/workspace.ts', 'utf8')
    expect(ws).toContain('findSnapshot(')
    expect(ws).toContain('setWorkSaver(')
    expect(ws).toContain('clearSnapshot(')
  })
})

describe('applying an update keeps the work', () => {
  it('snapshots before installing', async () => {
    const order: string[] = []
    const off = setWorkSaver(() => {
      order.push('save')
      return true
    })
    await applyUpdateKeepingWork(async () => {
      order.push('install')
    })
    expect(order).toEqual(['save', 'install'])
    off()
  })

  it('asks first when the snapshot fails and something is unsaved', async () => {
    const offSaver = setWorkSaver(() => false)
    const offProbe = setUnsavedWorkProbe(() => true)
    let installed = false
    const went = await applyUpdateKeepingWork(
      async () => {
        installed = true
      },
      () => false
    )
    expect(went).toBe(false)
    expect(installed).toBe(false)
    offSaver()
    offProbe()
  })

  it('a throwing saver counts as a failed save, not a crash', () => {
    const off = setWorkSaver(() => {
      throw new Error('boom')
    })
    expect(saveWorkForReload()).toBe(false)
    off()
  })

  it('both update buttons go through it', () => {
    for (const p of [
      'src/renderer/src/components/UpdateNotifier.tsx',
      'src/renderer/src/components/StatusBar.tsx'
    ]) {
      const src = readFileSync(p, 'utf8')
      expect(src, p).toContain('applyUpdateKeepingWork(')
      expect(src, p).not.toMatch(/void window\.api\.updates\.quitAndInstall\(\)/)
    }
  })
})

describe('the web build suggests rather than forces', () => {
  it('reloads quietly only on a fresh page with nothing unsaved', () => {
    expect(shouldApplyQuietly(1000, false)).toBe(true)
    expect(shouldApplyQuietly(1000, true)).toBe(false)
    expect(shouldApplyQuietly(BOOT_GRACE_MS + 1, false)).toBe(false)
    expect(shouldApplyQuietly(60 * 60 * 1000, false)).toBe(false)
  })
})
