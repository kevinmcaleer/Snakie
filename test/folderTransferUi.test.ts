import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parentOf, targetDirFor } from '../src/renderer/src/store/file-selection'

describe('device target directory (#848)', () => {
  it('reads a parent off a device path', () => {
    expect(parentOf('/lib/x.py')).toBe('/lib')
    expect(parentOf('/x.py')).toBe('/')
    expect(parentOf('/lib/sub/x.py')).toBe('/lib/sub')
    expect(parentOf('/')).toBe('/')
  })

  it('uses a highlighted FOLDER as the destination', () => {
    expect(targetDirFor({ path: '/lib', isDir: true })).toBe('/lib')
  })

  it('uses a highlighted FILE’s folder', () => {
    // Highlighting a file names a folder perfectly well — its parent — so the
    // button is not dead just because the click landed on a file.
    expect(targetDirFor({ path: '/lib/thing.py', isDir: false })).toBe('/lib')
  })

  it('falls back to the device root when nothing is highlighted', () => {
    expect(targetDirFor(null)).toBe('/')
  })
})

describe('the transfer dialog reports the two things that answer "is it stuck?"', () => {
  const src = readFileSync(
    'src/renderer/src/components/TransferProgressDialog.tsx',
    'utf8'
  )

  it('shows a progress bar with real ARIA values', () => {
    expect(src).toContain('role="progressbar"')
    expect(src).toMatch(/aria-valuenow=\{pct\}/)
  })

  it('ticks each file as it lands', () => {
    // ☑ done, ☒ failed, ☐ not yet — the list is the receipt.
    expect(src).toContain("row.state === 'done' ? '☑'")
    expect(src).toContain("row.state === 'error' ? '☒'")
  })

  it('dismisses itself on success but STAYS on failure', () => {
    // An error the user did not see is an error that did not happen, to them.
    expect(src).toMatch(/if \(running \|\| error\) return/)
    expect(src).toContain('setTimeout(onClose, AUTO_DISMISS_MS)')
  })

  it('treats Escape as "stop", not "hide", while running', () => {
    // Dismissing mid-copy would leave the transfer running with nothing
    // reporting it.
    expect(src).toMatch(/if \(running\) onCancel\(\)/)
  })
})

describe('the wiring holds the pieces together', () => {
  it('publishes both trees’ selections', () => {
    for (const f of ['LocalFileTree', 'DeviceFileTree']) {
      const src = readFileSync(`src/renderer/src/components/${f}.tsx`, 'utf8')
      expect(src, f).toContain('useFileSelection')
    }
  })

  it('lets a highlighted folder take precedence over the active buffer', () => {
    // The user pointed at something specific; uploading a different file
    // instead would be the wrong kind of clever.
    const src = readFileSync('src/renderer/src/components/UploadControls.tsx', 'utf8')
    expect(src).toContain('if (folderToUpload) return uploadFolder(folderToUpload)')
  })

  it('sends every file over the BYTES channel', () => {
    // A folder can hold a font, a .mpy, an image; the text channel round-trips
    // through UTF-8 and corrupts all three silently.
    const src = readFileSync('src/renderer/src/lib/folder-transfer.ts', 'utf8')
    expect(src).toContain('window.api.device.writeFileBytes')
    expect(src).not.toContain('window.api.device.writeFile(')
  })

  it('stops at the first failed file rather than reporting success at the end', () => {
    const src = readFileSync('src/renderer/src/lib/folder-transfer.ts', 'utf8')
    expect(src).toMatch(/return \{ ok: false, error: `\$\{file\.label\}/)
  })

  it('syncs a tagged folder into the highlight, read at sync time', () => {
    // A stale closure would send the folder wherever the user had clicked
    // previously.
    const src = readFileSync('src/renderer/src/store/sync.ts', 'utf8')
    expect(src).toContain('deviceTargetDirRef.current')
    expect(src).toContain('await isDirectory(path)')
  })
})
