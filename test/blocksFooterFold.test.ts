import { describe, expect, it } from 'vitest'
import { blocksFooterPayloadLines } from '../src/renderer/src/components/blocks-footer-fold'
import { writeBlocksFooter } from '../src/shared/blocks-doc'

describe('the code editor hides a blocks footer payload', () => {
  it('keeps the marker line and hides the comment lines under it', () => {
    const text = writeBlocksFooter('import time\nprint(1)\n', { blocks: { blocks: [] } })
    const lines = text.split('\n')
    const r = blocksFooterPayloadLines(lines)
    expect(r).not.toBeNull()
    expect(lines[r!.markerLine - 1]).toMatch(/snakie-blocks v1/)
    expect(r!.startLine).toBe(r!.markerLine + 1)
    for (let n = r!.startLine; n <= r!.endLine; n++) expect(lines[n - 1]).toMatch(/^# /)
    // The code above is untouched.
    expect(r!.markerLine).toBeGreaterThan(2)
  })
  it('does nothing for a plain file', () => {
    expect(blocksFooterPayloadLines(['import time', '# a comment'])).toBeNull()
  })
})
