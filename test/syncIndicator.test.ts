import { describe, it, expect } from 'vitest'
import {
  clearSyncMarks,
  markFiles,
  markKind,
  reconcileFiles,
  syncedCount,
  syncedFileList,
  type FileSyncMap
} from '../src/renderer/src/store/sync'
import { syncMode, syncSummary, tickFor } from '../src/renderer/src/components/SyncIndicator'

/**
 * The status-bar file-sync popup (#863).
 *
 * The popup's whole job is to answer "which of my tagged files is actually on
 * the board right now" — so these tests are about the RECORD KEEPING, which is
 * where that answer is either right or wrong. The component itself is a thin
 * map from this data onto three glyphs, and that mapping is tested directly at
 * the bottom.
 */

const F = (state: 'pending' | 'syncing' | 'done' | 'error'): { state: typeof state } => ({ state })

describe('reconcileFiles', () => {
  it('gives a newly tagged path a pending record', () => {
    expect(reconcileFiles({}, ['/a.py'])).toEqual({ '/a.py': { state: 'pending' } })
  })

  it('keeps what it already knows about a path that is still tagged', () => {
    const before: FileSyncMap = { '/a.py': { state: 'done', dir: false } }
    expect(reconcileFiles(before, ['/a.py'])).toEqual(before)
  })

  it('forgets a path that is no longer tagged', () => {
    const before: FileSyncMap = { '/a.py': F('done'), '/b.py': F('done') }
    expect(reconcileFiles(before, ['/a.py'])).toEqual({ '/a.py': F('done') })
  })

  it('does not resurrect a stale record when the same path is re-tagged', () => {
    // Untag then re-tag: the record went with the tag, so the file starts
    // pending again rather than claiming a tick it earned before it was dropped.
    const tagged = reconcileFiles({ '/a.py': F('done') }, [])
    expect(reconcileFiles(tagged, ['/a.py'])).toEqual({ '/a.py': { state: 'pending' } })
  })
})

describe('markFiles', () => {
  it('sets the state of the named paths only', () => {
    const before: FileSyncMap = { '/a.py': F('pending'), '/b.py': F('pending') }
    expect(markFiles(before, ['/a.py'], 'done')).toEqual({
      '/a.py': { state: 'done' },
      '/b.py': { state: 'pending' }
    })
  })

  it('carries an error message only on the error state', () => {
    expect(markFiles({}, ['/a.py'], 'error', 'no space left')).toEqual({
      '/a.py': { state: 'error', error: 'no space left' }
    })
    // A later success must not leave the old failure attached to the row.
    const failed = markFiles({}, ['/a.py'], 'error', 'no space left')
    expect(markFiles(failed, ['/a.py'], 'done')).toEqual({ '/a.py': { state: 'done' } })
  })

  it('preserves what a previous sync learned about the path being a directory', () => {
    const known = markKind({}, '/lib', true)
    expect(markFiles(known, ['/lib'], 'done')).toEqual({ '/lib': { state: 'done', dir: true } })
  })

  it('returns the same object when there is nothing to mark', () => {
    const before: FileSyncMap = { '/a.py': F('done') }
    expect(markFiles(before, [], 'syncing')).toBe(before)
  })
})

describe('clearSyncMarks', () => {
  it('drops every tick when the board goes away', () => {
    // A tick that means "synced to some board I saw earlier" is worse than none:
    // the next board to arrive may be a different one.
    const before: FileSyncMap = {
      '/a.py': { state: 'done', dir: false },
      '/lib': { state: 'error', error: 'boom', dir: true }
    }
    expect(clearSyncMarks(before)).toEqual({
      '/a.py': { state: 'pending', dir: false },
      '/lib': { state: 'pending', dir: true }
    })
  })

  it('keeps the paths themselves — disconnecting does not untag anything', () => {
    const before: FileSyncMap = { '/a.py': F('done'), '/b.py': F('pending') }
    expect(Object.keys(clearSyncMarks(before))).toEqual(['/a.py', '/b.py'])
  })
})

describe('syncedFileList', () => {
  it('lists tagged paths in tag order, with their basenames', () => {
    const rows = syncedFileList(['/home/kev/b.py', '/home/kev/a.py'], {}, '/')
    expect(rows.map((r) => r.name)).toEqual(['b.py', 'a.py'])
    expect(rows.every((r) => r.state === 'pending')).toBe(true)
  })

  it('shows no destination for a path no sync has looked at yet', () => {
    // A folder and a file land in different places, so guessing before we know
    // would point the user at somewhere the file is not.
    const [row] = syncedFileList(['/home/kev/thing'], {}, '/lib')
    expect(row.dest).toBeUndefined()
  })

  it('sends a known FILE to /<basename>', () => {
    const map = markKind({}, '/home/kev/main.py', false)
    expect(syncedFileList(['/home/kev/main.py'], map, '/lib')[0].dest).toBe('/main.py')
  })

  it('sends a known FOLDER into the highlighted device folder', () => {
    const map = markKind({}, '/home/kev/snakeros', true)
    expect(syncedFileList(['/home/kev/snakeros'], map, '/lib')[0].dest).toBe('/lib/snakeros')
    // …and follows the highlight, because that is what folder sync does (#848).
    expect(syncedFileList(['/home/kev/snakeros'], map, '/')[0].dest).toBe('/snakeros')
  })

  it('carries the failure message through to the row', () => {
    const map = markFiles({}, ['/a.py'], 'error', 'device is full')
    expect(syncedFileList(['/a.py'], map, '/')[0].error).toBe('device is full')
  })
})

describe('syncedCount', () => {
  it('counts only what actually reached the board', () => {
    const files = syncedFileList(
      ['/a.py', '/b.py', '/c.py', '/d.py'],
      markFiles(markFiles(markFiles({}, ['/a.py', '/b.py'], 'done'), ['/c.py'], 'syncing'), ['/d.py'], 'error', 'x'),
      '/'
    )
    expect(syncedCount(files)).toBe(2)
  })
})

describe('the glyph', () => {
  it('reads as off whenever auto-sync is off, however healthy the files are', () => {
    const files = syncedFileList(['/a.py'], markFiles({}, ['/a.py'], 'done'), '/')
    expect(syncMode(false, files, 'idle')).toBe('off')
  })

  it('reports a failed file ahead of a running sync', () => {
    // The user needs to know something did not make it, and that outlives the
    // next sync starting.
    const files = syncedFileList(['/a.py'], markFiles({}, ['/a.py'], 'error', 'x'), '/')
    expect(syncMode(true, files, 'syncing')).toBe('error')
  })

  it('spins while syncing and settles to on', () => {
    const files = syncedFileList(['/a.py'], markFiles({}, ['/a.py'], 'syncing'), '/')
    expect(syncMode(true, files, 'syncing')).toBe('syncing')
    expect(syncMode(true, syncedFileList(['/a.py'], markFiles({}, ['/a.py'], 'done'), '/'), 'idle')).toBe('on')
  })
})

describe('the summary line', () => {
  it('says how many of the tagged files are on the board', () => {
    const map = markFiles(reconcileFiles({}, ['/a.py', '/b.py', '/c.py']), ['/a.py'], 'done')
    const files = syncedFileList(['/a.py', '/b.py', '/c.py'], map, '/')
    expect(syncSummary(true, files)).toBe('File sync is on — 1 of 3 on the board')
  })

  it('names the state that catches people out: tagged files, sync off', () => {
    const files = syncedFileList(['/a.py', '/b.py'], {}, '/')
    expect(syncSummary(false, files)).toBe('File sync is off — 2 files tagged')
  })

  it('gets the singular right', () => {
    expect(syncSummary(false, syncedFileList(['/a.py'], {}, '/'))).toBe(
      'File sync is off — 1 file tagged'
    )
  })

  it('says so when sync is on but nothing is tagged', () => {
    expect(syncSummary(true, [])).toBe('File sync is on — no files tagged yet')
  })
})

describe('the row glyph', () => {
  it('uses the same three boxes as the folder transfer dialog (#848)', () => {
    expect(tickFor('done')).toBe('☑')
    expect(tickFor('error')).toBe('☒')
    expect(tickFor('pending')).toBe('☐')
    expect(tickFor('syncing')).toBe('☐')
  })
})
