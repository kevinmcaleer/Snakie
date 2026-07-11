import { describe, it, expect } from 'vitest'
import { splitRelSegments, childPath } from '../src/renderer/src/web/web-fs-paths'

// Path resolution for the web File System Access backend (epic #267). The
// interactive picker can't be automated, but the pure path math can — and it's
// where the bugs would be (walking the wrong segments off the root handle).
describe('splitRelSegments', () => {
  it('strips the root name and splits into segments', () => {
    expect(splitRelSegments('MyProject', 'MyProject/src/main.py')).toEqual(['src', 'main.py'])
  })
  it('returns [] for the bare root path (the root handle itself)', () => {
    expect(splitRelSegments('MyProject', 'MyProject')).toEqual([])
  })
  it('tolerates a leading slash', () => {
    expect(splitRelSegments('Root', '/Root/a/b.py')).toEqual(['a', 'b.py'])
  })
  it('drops empty segments (double / or trailing /)', () => {
    expect(splitRelSegments('R', 'R//x/')).toEqual(['x'])
  })
  it('handles a path that is not under the root (loose relative)', () => {
    expect(splitRelSegments('Root', 'a/b')).toEqual(['a', 'b'])
  })
  it('does not mis-strip a root that is only a name PREFIX', () => {
    // "RootX/f" must NOT be treated as under root "Root".
    expect(splitRelSegments('Root', 'RootX/f')).toEqual(['RootX', 'f'])
  })
})

describe('childPath', () => {
  it('joins parent + name without a double slash', () => {
    expect(childPath('a/b', 'c.py')).toBe('a/b/c.py')
    expect(childPath('a/b/', 'c.py')).toBe('a/b/c.py')
  })
})
