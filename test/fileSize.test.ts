import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { formatFileSize, rowSize } from '../src/shared/file-size'

/**
 * File sizes in the trees (#955).
 *
 * Neither tree showed how big a file was, which hid the case that matters: a
 * 0-byte file looks exactly like a good one. This repo has met that — a
 * truncated `lsm6dsox.py` on a board threw a `SyntaxError` at line 159 and cost
 * real diagnosis time, which is what #864's atomic writes exist to prevent.
 *
 * So most of what is tested here is about the two readings that must never be
 * confused: a file that really is empty, and a size we could not read.
 */

describe('the reading this column exists for', () => {
  it('says 0 B for an empty file, in bytes, unrounded', () => {
    // `formatBytes` in board-finder.ts — the app's other formatter — renders
    // this as "0 KB", which is exactly the reading this replaces.
    expect(formatFileSize(0)).toBe('0 B')
  })

  it('never rounds a small file away to zero', () => {
    expect(formatFileSize(1)).toBe('1 B')
    expect(formatFileSize(213)).toBe('213 B')
    expect(formatFileSize(1023)).toBe('1023 B')
  })

  it('is null — not "0 B" — when the size is unknown', () => {
    // A failed stat must render as NOTHING. A zero invented here would
    // manufacture the exact problem the column was added to reveal.
    for (const bad of [undefined, null, NaN, Infinity, -1, '512', {}]) {
      expect(formatFileSize(bad), String(bad)).toBeNull()
    }
  })
})

describe('the units people expect', () => {
  it('climbs B → KB → MB → GB → TB', () => {
    expect(formatFileSize(1024)).toBe('1 KB')
    expect(formatFileSize(1024 ** 2)).toBe('1 MB')
    expect(formatFileSize(1024 ** 3)).toBe('1 GB')
    expect(formatFileSize(1024 ** 4)).toBe('1 TB')
  })

  it('shows one decimal only where it says something', () => {
    // A column of sizes is scanned, not compared digit by digit, so "2 KB"
    // beats "2.0 KB" — but 1.5 MB is a different number from 1 MB.
    expect(formatFileSize(1536)).toBe('1.5 KB')
    expect(formatFileSize(2048)).toBe('2 KB')
    expect(formatFileSize(Math.round(1.4 * 1024 ** 3))).toBe('1.4 GB')
  })

  it('does not round up into a unit it has not reached', () => {
    // 1023.6 KB is not 1 MB. `.toFixed(1)` on the value keeps it in KB.
    expect(formatFileSize(1024 * 1023.6)).toContain('KB')
  })

  it('drops the decimal once the number is big enough not to need it', () => {
    expect(formatFileSize(1024 * 500)).toBe('500 KB')
  })

  it('stops at TB rather than inventing a unit above it', () => {
    expect(formatFileSize(1024 ** 5)).toBe('1024 TB')
  })
})

describe('what a tree row shows', () => {
  it('shows nothing for a folder', () => {
    // A folder is not an empty file, and saying "0 B" in the column that means
    // "this file is empty" would be a lie in the one place it is expensive.
    expect(rowSize({ isDir: true, size: 0 })).toBeNull()
    expect(rowSize({ isDir: true })).toBeNull()
  })

  it('shows the size for a file', () => {
    expect(rowSize({ isDir: false, size: 5157 })).toBe('5 KB')
    expect(rowSize({ isDir: false, size: 0 })).toBe('0 B')
  })

  it('shows nothing for a file whose size never arrived', () => {
    expect(rowSize({ isDir: false })).toBeNull()
    expect(rowSize({ isDir: false, size: null })).toBeNull()
  })
})

describe('both trees show it, and the local one has the data to', () => {
  it('the local listing stats each file', () => {
    // `readdir` knows the type but not the size.
    const ipc = readFileSync('src/main/fs/ipc.ts', 'utf8')
    expect(ipc).toContain('entry.size = (await fs.stat(full)).size')
  })

  it('a failed stat leaves the size ABSENT, not zero', () => {
    const ipc = readFileSync('src/main/fs/ipc.ts', 'utf8')
    const fn = ipc.slice(ipc.indexOf('async function readDir'), ipc.indexOf('async function stat'))
    // No fallback that would turn an unreadable file into an empty one.
    expect(fn).not.toMatch(/size:\s*0/)
    expect(fn).not.toMatch(/\?\?\s*0/)
  })

  it('is optional on the type, so "unknown" is expressible at all', () => {
    expect(readFileSync('src/main/fs/types.ts', 'utf8')).toContain('size?: number')
  })

  it('appears in both trees', () => {
    for (const f of [
      'src/renderer/src/components/LocalFileTree.tsx',
      'src/renderer/src/components/DeviceFileTree.tsx'
    ]) {
      expect(readFileSync(f, 'utf8'), f).toContain('tree-row__size')
    }
  })

  it('does not squeeze the name out to make room', () => {
    // The name takes the slack and ellipsizes; the size keeps its place.
    const css = readFileSync('src/renderer/src/index.css', 'utf8')
    const rule = css.slice(css.indexOf('.tree-row__size {'), css.indexOf('}', css.indexOf('.tree-row__size {')))
    expect(rule).toContain('margin-left: auto')
    expect(rule).toContain('flex: 0 0 auto')
    expect(rule).toContain('tabular-nums')
  })
})
