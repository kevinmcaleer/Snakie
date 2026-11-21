import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (p: string): string => readFileSync(p, 'utf8')

/**
 * The part-driver prompt lives in the Code workspace, as a chip beside Find
 * whose card floats over the code: a full-width row pushed the content down,
 * and the import that fails without the driver is in the code, not on the
 * breadboard.
 */
describe('driver chip in the Code workspace', () => {
  it('is offered beside Find in the code editor, not in the Board View', () => {
    const editor = read('src/renderer/src/components/EditorArea.tsx')
    expect(editor).toContain('<DriverInstallBanner')
    expect(editor).toContain('layout="chip"')
    expect(editor).toContain('const showDriverChip = chipView')
    expect(read('src/renderer/src/components/BoardGraph.tsx')).not.toContain('<DriverInstallBanner')
  })

  it('never greys Install out for want of a board: it asks to connect, then installs', () => {
    const src = read('src/renderer/src/components/DriverInstallBanner.tsx')
    expect(src).not.toContain('disabled: running || !connected')
    expect(src).toContain("dispatchDeviceAction('connect')")
    expect(src).toContain('void installRef.current()')
  })

  it('floats its card over the editor rather than taking a row', () => {
    const css = read('src/renderer/src/components/DriverInstallBanner.css')
    expect(css).toMatch(/\.drvchip__pop\s*{[^}]*position:\s*fixed/)
  })
})

describe('one notice, no push-down banners (#166 + #184)', () => {
  it('passes the parts check to the editor chip instead of a banner above the app', () => {
    const shell = read('src/renderer/src/components/AppShell.tsx')
    expect(shell).not.toContain('<PartsImportBanner')
    expect(shell).toContain('partsNotice={')
  })
  it('shows the chip for blocks files too, and the split drops its own banner', () => {
    const editor = read('src/renderer/src/components/EditorArea.tsx')
    expect(editor).toContain('chipView = codeWorkspace && (showCode || showBlocks)')
    expect(editor).toContain('onDriverNeeds={setBlocksNeeds}')
    expect(read('src/renderer/src/components/BlocksSplit.tsx')).toContain(
      '{!onDriverNeeds && driverNeeds.length > 0 && <DriverInstallBanner'
    )
  })
})
