import { describe, it, expect } from 'vitest'
import {
  serialiseSession,
  saveSession,
  readSession,
  restoreMode,
  markRestoreStart,
  markRestoreDone,
  SESSION_KEY,
  RESTORE_GUARD_KEY
} from '../src/renderer/src/store/session-restore'

/** In-memory SessionStorage. */
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

const f = (source: 'local' | 'device', path: string) => ({ source, path, id: `${source}:${path}` })

describe('serialiseSession (#266)', () => {
  it('keeps LOCAL files (in order) and the active path; drops device + unsaved', () => {
    const files = [f('local', '/a.py'), f('device', '/dev/x.py'), f('local', '/b.py'), f('local', '')]
    const s = serialiseSession(files, 'local:/b.py')
    expect(s.paths).toEqual(['/a.py', '/b.py'])
    expect(s.activePath).toBe('/b.py')
  })

  it('active on a non-local file → null active', () => {
    const s = serialiseSession([f('local', '/a.py'), f('device', '/d.py')], 'device:/d.py')
    expect(s.activePath).toBeNull()
    expect(s.paths).toEqual(['/a.py'])
  })
})

describe('save / read session (#266)', () => {
  it('round-trips', () => {
    const s = mem()
    saveSession(s, [f('local', '/a.py'), f('local', '/b.py')], 'local:/a.py')
    expect(readSession(s)).toEqual({ paths: ['/a.py', '/b.py'], activePath: '/a.py' })
  })

  it('an empty session removes the key (no stale restore)', () => {
    const s = mem({ [SESSION_KEY]: '{"paths":["/old.py"],"activePath":"/old.py"}' })
    saveSession(s, [f('device', '/d.py')], null) // no local files
    expect(s.getItem(SESSION_KEY)).toBeNull()
  })

  it('corrupt / wrong-shape stored session → null', () => {
    expect(readSession(mem({ [SESSION_KEY]: 'not json{{' }))).toBeNull()
    expect(readSession(mem({ [SESSION_KEY]: '{"paths":"nope"}' }))).toBeNull()
    expect(readSession(mem())).toBeNull()
  })

  it('sanitises non-string paths out of a stored list', () => {
    const s = mem({ [SESSION_KEY]: '{"paths":["/a.py",5,"",null,"/b.py"],"activePath":7}' })
    expect(readSession(s)).toEqual({ paths: ['/a.py', '/b.py'], activePath: null })
  })
})

describe('crash-guard (#266)', () => {
  it('no marker → safe to restore; sets + clears the marker', () => {
    const s = mem()
    expect(restoreMode(s)).toBe('safe')
    markRestoreStart(s)
    expect(s.getItem(RESTORE_GUARD_KEY)).toBe('1')
    markRestoreDone(s)
    expect(s.getItem(RESTORE_GUARD_KEY)).toBeNull()
  })

  it('a leftover marker from a crashed launch → recover (skip restore)', () => {
    const s = mem({ [RESTORE_GUARD_KEY]: '1' })
    expect(restoreMode(s)).toBe('recover')
  })

  it('models a crash loop then self-heal', () => {
    const s = mem()
    // Launch 1: safe → arm, then "crash" before markRestoreDone.
    expect(restoreMode(s)).toBe('safe')
    markRestoreStart(s)
    // Launch 2: marker survived → recover, and we clear it.
    expect(restoreMode(s)).toBe('recover')
    markRestoreDone(s)
    // Launch 3: clean again.
    expect(restoreMode(s)).toBe('safe')
  })
})
