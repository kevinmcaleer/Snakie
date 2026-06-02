import { describe, expect, it } from 'vitest'
import { baseName } from '../src/renderer/src/store/workspace'

/**
 * Unit tests for the pure `baseName` helper used by the workspace store's
 * "Save As" flow to derive an OpenFile's display name from a chosen path.
 */
describe('baseName', () => {
  it('returns the final segment of a POSIX path', () => {
    expect(baseName('/home/kev/projects/main.py')).toBe('main.py')
  })

  it('returns the final segment of a Windows path', () => {
    expect(baseName('C:\\Users\\kev\\main.py')).toBe('main.py')
  })

  it('ignores a trailing separator', () => {
    expect(baseName('/home/kev/folder/')).toBe('folder')
  })

  it('returns the input when there is no separator', () => {
    expect(baseName('untitled.py')).toBe('untitled.py')
  })
})
