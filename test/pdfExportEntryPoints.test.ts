// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import type { MenuCommand } from '../src/shared/menu-commands'
import { RENDERER_MENU_COMMANDS, menuStateFrom } from '../src/shared/menu-commands'
import { appMenuTemplate } from '../src/shared/menu-template'
import { menuCommandHandlers } from '../src/renderer/src/lib/menuCommands'
import { dispatchExportPdf, onExportPdf } from '../src/renderer/src/components/export-bus'
import { omissionMessage } from '../src/renderer/src/lib/pdf/export-project'
import { savePdf } from '../src/renderer/src/lib/pdf/save-pdf'

/**
 * The user-facing entry points (#1114): the print icon, `File ▸ Export to
 * PDF…`, and saving the result on both hosts.
 */

const SRC = (p: string): string => readFileSync(join(__dirname, '..', 'src', p), 'utf-8')
const TOOLBAR = SRC('renderer/src/components/Toolbar.tsx')

function fileSubmenu(fired: MenuCommand[]): ReturnType<typeof appMenuTemplate>[number]['submenu'] {
  const template = appMenuTemplate({
    appName: 'Snakie',
    isMac: true,
    onCommand: (id) => fired.push(id)
  })
  return template.find((m) => m.label === 'File')?.submenu
}

describe('the toolbar print button', () => {
  it('sits in the File actions group, next to New and Save', () => {
    const group = TOOLBAR.slice(
      TOOLBAR.indexOf('aria-label="File actions"'),
      TOOLBAR.indexOf('toolbar__divider')
    )
    expect(group).toContain('aria-label="New file"')
    expect(group).toContain('aria-label="Save active file"')
    expect(group).toContain('aria-label="Export the project as a PDF"')
    // #1105 asked for it "next to the New and Save icon" — last in the segment.
    expect(group.indexOf('aria-label="Save active file"')).toBeLessThan(
      group.indexOf('aria-label="Export the project as a PDF"')
    )
  })

  it('is an inline SVG in the same idiom as the others', () => {
    expect(TOOLBAR).toContain('const PRINT_ICON = ToolIcon(')
    expect(TOOLBAR).toContain('{PRINT_ICON}')
  })

  it('has a busy state, because rasterising a big project is not instant', () => {
    expect(TOOLBAR).toContain('aria-busy={exporting || undefined}')
    expect(TOOLBAR).toContain('disabled={exporting}')
  })

  it('answers the menu through the export bus rather than reimplementing it', () => {
    expect(TOOLBAR).toContain('onExportPdf(handleExportPdf)')
  })
})

describe('File ▸ Export to PDF…', () => {
  it('is on the File menu, after Save As', () => {
    const fired: MenuCommand[] = []
    const items = fileSubmenu(fired)
    const labels = (Array.isArray(items) ? items : []).map((i) => i.label).filter(Boolean)
    expect(labels).toContain('Export to PDF…')
    expect(labels.indexOf('Save As…')).toBeLessThan(labels.indexOf('Export to PDF…'))
  })

  it('carries an accelerator, so the shortcut sheet lists it for free', () => {
    const items = fileSubmenu([])
    const item = (Array.isArray(items) ? items : []).find((i) => i.label === 'Export to PDF…')
    expect(item?.accelerator).toBe('CmdOrCtrl+P')
  })

  it('sends the command the renderer knows', () => {
    const fired: MenuCommand[] = []
    const items = fileSubmenu(fired)
    const item = (Array.isArray(items) ? items : []).find((i) => i.label === 'Export to PDF…')
    item?.click?.(undefined as never, undefined as never, undefined as never)
    expect(fired).toEqual(['file.exportPdf'])
    expect(RENDERER_MENU_COMMANDS).toContain('file.exportPdf')
  })

  it('stays available with no file open — a project is more than its .py', () => {
    const state = menuStateFrom({
      workspace: 'code',
      hasActiveFile: false,
      connected: false,
      hasSyncedFiles: false,
      recentFolders: []
    })
    expect(state.enabled['file.save']).toBe(false)
    expect(state.enabled['file.exportPdf']).toBeUndefined()
  })
})

describe('the dispatcher', () => {
  it('routes the command to the toolbar', () => {
    const exportPdf = vi.fn()
    const handlers = menuCommandHandlers({ exportPdf } as never)
    handlers['file.exportPdf']()
    expect(exportPdf).toHaveBeenCalledTimes(1)
  })
})

describe('the export bus', () => {
  it('carries the request to whoever owns the button', () => {
    const run = vi.fn()
    const off = onExportPdf(run)
    dispatchExportPdf()
    expect(run).toHaveBeenCalledTimes(1)
    off()
    dispatchExportPdf()
    expect(run).toHaveBeenCalledTimes(1)
  })
})

describe('saving on both hosts', () => {
  const bytes = new Uint8Array([1, 2, 3])
  const setUserAgent = (ua: string): void => {
    Object.defineProperty(window.navigator, 'userAgent', { value: ua, configurable: true })
  }

  afterEach(() => {
    vi.unstubAllGlobals()
    setUserAgent('Mozilla/5.0 (X11; Linux x86_64)')
  })

  it('uses the native dialog and the fs bridge on the desktop', async () => {
    setUserAgent('Mozilla/5.0 Electron/38.0.0 Snakie/1.0')
    const saveFileDialog = vi.fn(async () => '/home/kev/servo-arm.pdf')
    const writeFileBytes = vi.fn(async () => undefined)
    ;(window as unknown as { api: unknown }).api = { fs: { saveFileDialog, writeFileBytes } }

    const result = await savePdf(bytes, 'servo-arm.pdf')
    expect(saveFileDialog).toHaveBeenCalledWith('servo-arm.pdf', {
      filters: [{ name: 'PDF document', extensions: ['pdf'] }]
    })
    expect(writeFileBytes).toHaveBeenCalledWith('/home/kev/servo-arm.pdf', bytes)
    expect(result).toEqual({ outcome: 'saved', path: '/home/kev/servo-arm.pdf' })
  })

  it('writes nothing when the desktop dialog is cancelled', async () => {
    setUserAgent('Mozilla/5.0 Electron/38.0.0 Snakie/1.0')
    const writeFileBytes = vi.fn(async () => undefined)
    ;(window as unknown as { api: unknown }).api = {
      fs: { saveFileDialog: async () => null, writeFileBytes }
    }
    expect(await savePdf(bytes, 'x.pdf')).toEqual({ outcome: 'cancelled' })
    expect(writeFileBytes).not.toHaveBeenCalled()
  })

  it('downloads it on the web', async () => {
    setUserAgent('Mozilla/5.0 (X11; Linux x86_64) Chrome/140')
    const createObjectURL = vi.fn(() => 'blob:snakie/1')
    const revokeObjectURL = vi.fn()
    Object.assign(URL, { createObjectURL, revokeObjectURL })
    const clicked: string[] = []
    const realCreate = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      const el = realCreate(tag)
      if (tag === 'a')
        el.addEventListener('click', () => clicked.push((el as HTMLAnchorElement).download))
      return el
    }) as typeof document.createElement)

    const result = await savePdf(bytes, 'servo-arm.pdf')
    expect(createObjectURL).toHaveBeenCalled()
    expect(clicked).toEqual(['servo-arm.pdf'])
    expect(result).toEqual({ outcome: 'saved', path: 'servo-arm.pdf' })
  })
})

describe('telling the user what was left out', () => {
  it('names one missing section', () => {
    expect(omissionMessage([{ section: 'wiring', reason: 'x' }])).toBe(
      'PDF exported without the wiring diagram.'
    )
  })

  it('joins two with an "and"', () => {
    expect(
      omissionMessage([
        { section: 'blocks', reason: 'x' },
        { section: 'wiring', reason: 'y' }
      ])
    ).toBe('PDF exported without the blocks and the wiring diagram.')
  })
})
