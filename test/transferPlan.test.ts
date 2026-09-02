import { describe, it, expect } from 'vitest'
import {
  deviceDestFor,
  deviceJoin,
  hostBaseName,
  normaliseDevicePath,
  planFolderUpload,
  shouldSkip,
  type LocalEntry
} from '../src/shared/transfer-plan'

describe('device path shaping', () => {
  it('normalises to an absolute, single-separator path', () => {
    expect(normaliseDevicePath('lib/foo')).toBe('/lib/foo')
    expect(normaliseDevicePath('/lib//foo/')).toBe('/lib/foo')
    expect(normaliseDevicePath('')).toBe('/')
    expect(normaliseDevicePath('/')).toBe('/')
  })

  it('joins without doubling or dropping separators', () => {
    expect(deviceJoin('/lib', 'mylib')).toBe('/lib/mylib')
    expect(deviceJoin('/', 'mylib')).toBe('/mylib')
    expect(deviceJoin('/lib/', '/mylib/', 'a.py')).toBe('/lib/mylib/a.py')
  })

  it('reads a folder name off either platform separator', () => {
    expect(hostBaseName('/Users/kev/code/mylib')).toBe('mylib')
    expect(hostBaseName('C:\\Users\\kev\\code\\mylib')).toBe('mylib')
    expect(hostBaseName('/Users/kev/code/mylib/')).toBe('mylib')
    expect(hostBaseName('/')).toBe('')
  })
})

describe('deviceDestFor', () => {
  it('copies the folder INTO the target, keeping its own name', () => {
    // What every file manager means by "copy this folder into that folder".
    // Flattening the contents straight into the target would silently merge
    // two trees instead.
    expect(deviceDestFor('/Users/kev/mylib', '/Users/kev/mylib/a.py', '/lib')).toBe(
      '/lib/mylib/a.py'
    )
  })

  it('preserves nesting', () => {
    expect(deviceDestFor('/Users/kev/mylib', '/Users/kev/mylib/sub/deep/b.py', '/lib')).toBe(
      '/lib/mylib/sub/deep/b.py'
    )
  })

  it('handles the device root as a target', () => {
    expect(deviceDestFor('/Users/kev/mylib', '/Users/kev/mylib/a.py', '/')).toBe('/mylib/a.py')
  })

  it('maps Windows sources onto POSIX device paths', () => {
    expect(deviceDestFor('C:\\code\\mylib', 'C:\\code\\mylib\\sub\\a.py', '/lib')).toBe(
      '/lib/mylib/sub/a.py'
    )
  })

  it('refuses a path that is not inside the root', () => {
    // A caller that walked a different tree than it planned would otherwise
    // write files to confidently wrong places.
    expect(deviceDestFor('/Users/kev/mylib', '/Users/kev/other/a.py', '/lib')).toBeNull()
    expect(deviceDestFor('/Users/kev/mylib', '/Users/kev', '/lib')).toBeNull()
  })
})

describe('planFolderUpload', () => {
  const root = '/Users/kev/mylib'
  const entries: LocalEntry[] = [
    { path: '/Users/kev/mylib/sub', isDir: true },
    { path: '/Users/kev/mylib/sub/deep/b.py', isDir: false, size: 200 },
    { path: '/Users/kev/mylib/a.py', isDir: false, size: 100 },
    { path: '/Users/kev/mylib/sub/deep', isDir: true }
  ]

  it('creates parent directories before their children', () => {
    // `mkdir` cannot make /a/b before /a, and a walk is not obliged to hand
    // them over in that order.
    const plan = planFolderUpload(root, entries, '/lib')
    expect(plan.dirs).toEqual(['/lib/mylib', '/lib/mylib/sub', '/lib/mylib/sub/deep'])
  })

  it('infers directories a walk did not list', () => {
    // A file whose parent was never listed must still get its parent made.
    const plan = planFolderUpload(
      root,
      [{ path: '/Users/kev/mylib/x/y/z.py', isDir: false, size: 1 }],
      '/lib'
    )
    expect(plan.dirs).toEqual(['/lib/mylib', '/lib/mylib/x', '/lib/mylib/x/y'])
  })

  it('never proposes creating the device root', () => {
    const plan = planFolderUpload(root, entries, '/')
    expect(plan.dirs).not.toContain('/')
    expect(plan.root).toBe('/mylib')
  })

  it('resolves every file to both ends, with a readable label', () => {
    const plan = planFolderUpload(root, entries, '/lib')
    expect(plan.files).toEqual([
      {
        local: '/Users/kev/mylib/sub/deep/b.py',
        device: '/lib/mylib/sub/deep/b.py',
        label: 'sub/deep/b.py',
        size: 200
      },
      { local: '/Users/kev/mylib/a.py', device: '/lib/mylib/a.py', label: 'a.py', size: 100 }
    ])
  })

  it('totals bytes for the progress bar', () => {
    expect(planFolderUpload(root, entries, '/lib').totalBytes).toBe(300)
  })

  it('still creates the folder when it is empty', () => {
    const plan = planFolderUpload(root, [], '/lib')
    expect(plan.dirs).toEqual(['/lib/mylib'])
    expect(plan.files).toEqual([])
  })
})

describe('shouldSkip', () => {
  it('leaves developer bookkeeping on the host', () => {
    // A .git directory alone would exhaust a Pico's filesystem.
    for (const d of ['.git', '__pycache__', 'node_modules', '.venv', '.vscode']) {
      expect(shouldSkip(d, true), d).toBe(true)
    }
    expect(shouldSkip('.DS_Store', false)).toBe(true)
    expect(shouldSkip('main.pyc', false)).toBe(true)
    expect(shouldSkip('notes.txt~', false)).toBe(true)
  })

  it('sends everything the user actually wrote', () => {
    // Not a general ignore mechanism — a boring list of never-board-files.
    expect(shouldSkip('main.py', false)).toBe(false)
    expect(shouldSkip('data.json', false)).toBe(false)
    expect(shouldSkip('lib', true)).toBe(false)
    expect(shouldSkip('.gitkeep', false)).toBe(false)
  })

  it('does not skip a FILE that shares a skipped directory name', () => {
    expect(shouldSkip('.git', false)).toBe(false)
  })
})
