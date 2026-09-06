import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * An empty buffer must never be written back as if it were the file (#964).
 *
 * A `.mpy` opens with no text on purpose: it is bytecode, reading it as UTF-8
 * would mangle it, and the Bytecode view (#875) fetches the real bytes itself.
 * The empty string in `content` is a PLACEHOLDER, not the file.
 *
 * Three writers treated it as the file. Uploading produced a 0-byte file on the
 * board — the reported symptom — and `saveFile`, which has no dirty check,
 * replaced the `.mpy` ON DISK with nothing. #915 made that far easier to reach
 * by moving ⌘S out of the editor and onto the menu, where it fires with a
 * Bytecode tab focused.
 *
 * So the fact lives on the open file rather than being re-derived from the
 * extension by each writer: the writer that forgets to re-derive it is the one
 * that deletes somebody's work.
 */

const store = readFileSync('src/renderer/src/store/workspace.ts', 'utf8')
const upload = readFileSync('src/renderer/src/components/UploadControls.tsx', 'utf8')

/** The body of the single-file upload task — the one that writes `dest`. */
const uploadRun = ((): string => {
  const at = upload.indexOf('run: async () =>')
  expect(at, 'the single-file upload task moved').toBeGreaterThan(-1)
  return upload.slice(at, at + 1400)
})()

describe('the file itself says its buffer is not the file', () => {
  it('carries a `binary` flag rather than leaving each writer to guess', () => {
    expect(store).toMatch(/binary\?: boolean/)
    expect(store).toContain('binary: isMpyFile(path)')
  })

  it('sets it from the same rule that empties the buffer', () => {
    // If these two ever disagree, a file opens empty and nothing knows it.
    const open = store.slice(store.indexOf('const openFile = useCallback'))
    const head = open.slice(0, 1200)
    expect(head).toContain("isMpyFile(path)\n      ? ''")
    expect(head).toContain('binary: isMpyFile(path)')
  })
})

describe('saving refuses', () => {
  it('returns before writing anything', () => {
    const fn = store.slice(store.indexOf('const saveFile = useCallback'))
    const guard = fn.indexOf('if (file.binary) return')
    expect(guard, 'no binary guard in saveFile').toBeGreaterThan(-1)
    // BEFORE both write paths, not after one of them.
    expect(guard).toBeLessThan(fn.indexOf('fs.writeFile'))
    expect(guard).toBeLessThan(fn.indexOf('device.writeFile'))
  })

  it('is the only thing stopping it, because there is no dirty check', () => {
    // Worth pinning: `saveFile` writes whether or not anything changed, so the
    // Bytecode view being read-only does not protect the file — only this does.
    const fn = store.slice(
      store.indexOf('const saveFile = useCallback'),
      store.indexOf('const saveFileAs')
    )
    expect(fn).not.toMatch(/if \(!file\.dirty\)\s*return/)
  })
})

describe('uploading sends the file, not the placeholder', () => {
  it('reads a binary file from disk and writes bytes', () => {
    const run = uploadRun
    expect(run).toContain('activeFile.binary')
    expect(run).toContain('readFileBytes')
    expect(run).toContain('writeFileBytes')
  })

  it('does it atomically, like every other copy to the board', () => {
    expect(upload).toContain('writeAtomically(deviceAtomicOps')
  })

  it('still uploads a TEXT buffer as it stands, unsaved edits and all', () => {
    // That is the point of this control and has always been how it works — the
    // fix must not quietly turn it into "upload what is on disk".
    const run = uploadRun
    expect(run).toContain('window.api.device.writeFile(dest, activeFile.content)')
  })
})
