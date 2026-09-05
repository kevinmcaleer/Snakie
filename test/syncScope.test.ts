import { describe, it, expect } from 'vitest'
import {
  forgetTagsPrompt,
  forgotTagsMessage,
  isUnderFolder,
  pathsInFolder,
  reconcileFiles,
  syncedFileList,
  markFiles
} from '../src/renderer/src/store/sync'

/**
 * Sync tags are scoped to the folder on screen (#881).
 *
 * The bug these guard against is a quiet one: a tag is an absolute path, it
 * outlived the folder it was made in, and so opening a different project left
 * yesterday's files still being pushed to the board with nothing on screen to
 * say so. Two separate properties fix it, and they are tested separately on
 * purpose — the filtering has to hold on its own, without relying on the
 * forgetting having happened, because a list persisted by an older version has
 * never been through a folder change at all.
 */

describe('isUnderFolder', () => {
  it('accepts a file directly inside the folder', () => {
    expect(isUnderFolder('/home/kev/proj', '/home/kev/proj/main.py')).toBe(true)
  })

  it('accepts a file deep inside it — a collapsed subfolder is still in the tree', () => {
    // "Visible" means reachable by expanding, not literally on screen: folding a
    // folder away must not quietly stop its files syncing.
    expect(isUnderFolder('/home/kev/proj', '/home/kev/proj/lib/drivers/oled.py')).toBe(true)
  })

  it('rejects a file in a different project', () => {
    expect(isUnderFolder('/home/kev/proj', '/home/kev/other/main.py')).toBe(false)
  })

  it('rejects an ANCESTOR of the folder — up is out of the tree, not in it', () => {
    expect(isUnderFolder('/home/kev/proj', '/home/kev/main.py')).toBe(false)
  })

  it('rejects the folder itself: the tree lists its children, so it has no tick box', () => {
    expect(isUnderFolder('/home/kev/proj', '/home/kev/proj')).toBe(false)
    expect(isUnderFolder('/home/kev/proj/', '/home/kev/proj')).toBe(false)
  })

  it('does not let one folder swallow a sibling whose name starts the same', () => {
    // A prefix match on the raw string would take `/home/kev/proj2` for a child
    // of `/home/kev/proj`, and push a whole other project's files.
    expect(isUnderFolder('/home/kev/proj', '/home/kev/proj2/main.py')).toBe(false)
    expect(isUnderFolder('/home/kev/proj', '/home/kev/projector/main.py')).toBe(false)
  })

  it('answers the same for a Windows path as for a POSIX one', () => {
    expect(isUnderFolder('C:\\Users\\kev\\proj', 'C:\\Users\\kev\\proj\\lib\\main.py')).toBe(true)
    expect(isUnderFolder('C:\\Users\\kev\\proj', 'C:\\Users\\kev\\other\\main.py')).toBe(false)
    expect(isUnderFolder('D:\\proj', 'C:\\proj\\main.py')).toBe(false)
  })

  it('compares case exactly — a difference in case means a different tree', () => {
    expect(isUnderFolder('/home/kev/Proj', '/home/kev/proj/main.py')).toBe(false)
  })

  it('has nothing in scope when no folder is open', () => {
    expect(isUnderFolder(null, '/home/kev/proj/main.py')).toBe(false)
    expect(isUnderFolder('', '/home/kev/proj/main.py')).toBe(false)
  })
})

describe('pathsInFolder', () => {
  it('keeps only the tags the open folder can show, in tag order', () => {
    const tagged = ['/home/kev/proj/b.py', '/home/kev/other/x.py', '/home/kev/proj/a.py']
    expect(pathsInFolder(tagged, '/home/kev/proj')).toEqual([
      '/home/kev/proj/b.py',
      '/home/kev/proj/a.py'
    ])
  })

  it('keeps a tagged FOLDER, which syncs recursively (#848)', () => {
    expect(pathsInFolder(['/home/kev/proj/lib'], '/home/kev/proj')).toEqual(['/home/kev/proj/lib'])
  })

  it('drops everything while no folder is open, without being told to', () => {
    // A tag list restored from storage before the last folder has been restored
    // is not yet anybody's list: nothing is on screen, so nothing may be pushed.
    expect(pathsInFolder(['/home/kev/proj/a.py'], null)).toEqual([])
  })

  it('filters a list persisted by an older version, which never saw a folder change', () => {
    // The safety half must not depend on the forgetting half having run.
    const stale = ['/home/kev/2019-project/blink.py', '/home/kev/proj/main.py']
    expect(pathsInFolder(stale, '/home/kev/proj')).toEqual(['/home/kev/proj/main.py'])
  })

  it('keeps every tag when the tree is re-rooted UP to a parent', () => {
    // The breadcrumb only ever widens the tree, which is why it is left
    // unguarded: nothing that was visible stops being visible.
    const tagged = ['/home/kev/proj/a.py', '/home/kev/proj/lib/b.py']
    expect(pathsInFolder(tagged, '/home/kev')).toEqual(tagged)
  })

  it('drops the tags that fall outside a NARROWER root', () => {
    const tagged = ['/home/kev/proj/a.py', '/home/kev/proj/lib/b.py']
    expect(pathsInFolder(tagged, '/home/kev/proj/lib')).toEqual(['/home/kev/proj/lib/b.py'])
  })
})

describe('the record keeping stays coherent with the scope (#863)', () => {
  it('drops the popup row for a tag that is no longer in the folder', () => {
    // The glyph's count, the summary line and the rows all read from this, so a
    // scoped-out tag has to leave all of them at once — a "1 of 2 on the board"
    // where the missing one cannot be seen is exactly the confusion in #881.
    const before = markFiles({}, ['/home/kev/proj/a.py', '/home/kev/other/x.py'], 'done')
    const scoped = pathsInFolder(Object.keys(before), '/home/kev/proj')
    const map = reconcileFiles(before, scoped)
    expect(Object.keys(map)).toEqual(['/home/kev/proj/a.py'])
    expect(syncedFileList(scoped, map, '/').map((r) => r.name)).toEqual(['a.py'])
  })
})

describe('forgetTagsPrompt', () => {
  it('says nothing when there is nothing to lose', () => {
    expect(forgetTagsPrompt(0)).toBeNull()
  })

  it('hedges, because the folder picked may yet contain the tagged files', () => {
    const message = forgetTagsPrompt(3)
    expect(message).toContain('3 files are tagged')
    expect(message).toContain('unless the files are inside the folder you pick')
  })

  it('gets the singular right', () => {
    const message = forgetTagsPrompt(1)
    expect(message).toContain('1 file is tagged')
    expect(message).toContain('that tag')
    expect(message).toContain('unless the file is inside the folder you pick')
  })
})

describe('forgotTagsMessage', () => {
  it('says how many tags went, and why', () => {
    expect(forgotTagsMessage(2)).toBe("Forgot 2 sync tags — those files aren't in this folder")
    expect(forgotTagsMessage(1)).toBe("Forgot 1 sync tag — that file isn't in this folder")
  })
})
