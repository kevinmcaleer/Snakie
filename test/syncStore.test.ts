import { describe, it, expect } from 'vitest'
import { deviceDestForLocal, parseSyncedPaths } from '../src/renderer/src/store/sync'

/** Pure helpers backing the file-sync store (#178). */
describe('deviceDestForLocal', () => {
  it('maps a POSIX local path to /<basename> on the device', () => {
    expect(deviceDestForLocal('/home/kev/proj/main.py')).toBe('/main.py')
    expect(deviceDestForLocal('/home/kev/proj/sub/blink.py')).toBe('/blink.py')
  })

  it('handles Windows separators', () => {
    expect(deviceDestForLocal('C:\\Users\\kev\\blink.py')).toBe('/blink.py')
  })

  it('handles a bare filename', () => {
    expect(deviceDestForLocal('main.py')).toBe('/main.py')
  })
})

describe('parseSyncedPaths', () => {
  it('returns an empty list for missing or corrupt storage', () => {
    expect(parseSyncedPaths(null)).toEqual([])
    expect(parseSyncedPaths('')).toEqual([])
    expect(parseSyncedPaths('not json')).toEqual([])
    expect(parseSyncedPaths('{"x":1}')).toEqual([])
  })

  it('round-trips a list of paths', () => {
    expect(parseSyncedPaths('["/a/b.py","/c.py"]')).toEqual(['/a/b.py', '/c.py'])
  })

  it('drops non-string entries defensively', () => {
    expect(parseSyncedPaths('["/a.py", 5, null, "/b.py"]')).toEqual(['/a.py', '/b.py'])
  })
})
