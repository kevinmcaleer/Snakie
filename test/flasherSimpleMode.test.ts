import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * #833 — a simple flash dialog, with the rest behind a disclosure.
 *
 * Reported by someone who could not get their own board flashed through the UI:
 * "If I can't do it via the UI, I doubt users will make the right choices
 * either." The dialog asked for a board type, a flash offset, an erase decision
 * and a firmware source before it would do anything — every one of which either
 * follows from knowing the board or should not be a decision at all.
 *
 * Checked at SOURCE level. The dialog is Electron-only, so `isElectron()` is
 * false under `renderToStaticMarkup` and every branch that matters is skipped —
 * a render test here would pass while asserting nothing.
 */
const SRC = readFileSync(
  join(__dirname, '..', 'src/renderer/src/components/FirmwareFlasher.tsx'),
  'utf-8'
)

describe('the simple path', () => {
  it('offers ONE action for "what have I plugged in", not two', () => {
    // Detect scanned USB; Identify asked the board what it was. Two buttons for
    // two halves of one question, and the second only worked once the first had
    // set a port.
    expect(SRC).toContain('Detect board')
    expect(SRC).not.toContain('Identify board')
    expect(SRC).not.toContain('⟳ Detect<')
  })

  it('that action both scans and asks, then decides whether advanced is needed', () => {
    const fn = /const detectBoard = useCallback\(async[\s\S]*?\}, \[[^\]]*\]\)/.exec(SRC)
    expect(fn, 'detectBoard not found').toBeTruthy()
    expect(fn![0]).toContain('refreshDetection')
    expect(fn![0]).toContain('identifyBoard')
    expect(fn![0]).toContain('setAdvancedOpen(true)')
  })

  it('defaults the firmware source to the catalog, not a local file', () => {
    // Downloading the official build needs no prior knowledge; picking a file
    // off disk assumes you have already been somewhere else to get it.
    expect(SRC).toMatch(/useState<Source>\('catalog'\)/)
  })

  it('starts with the advanced fields closed', () => {
    expect(SRC).toMatch(/const \[advancedOpen, setAdvancedOpen\] = useState\(false\)/)
  })
})

describe('what is behind the disclosure', () => {
  /** The JSX for a labelled field, with whatever guards precede it. */
  function contextOf(label: string): string {
    const i = SRC.indexOf(label)
    expect(i, `${label} not found`).toBeGreaterThan(-1)
    return SRC.slice(Math.max(0, i - 700), i)
  }

  // Anchored on the ELEMENTS, not on prose: the same words appear in the doc
  // comments above, and matching those would assert nothing about the JSX.
  it.each([
    ['Board type', 'htmlFor="firmware-board"'],
    ['Flash offset', 'htmlFor="firmware-offset"'],
    ['Erase first', 'checked={eraseFirst}'],
    ['Firmware source', '>Firmware source<']
  ])('%s is gated on advancedOpen', (_name, anchor) => {
    expect(contextOf(anchor)).toContain('advancedOpen')
  })

  it('leaves the things you DO need in the simple view', () => {
    // The board, the port and the version are the actual inputs; gating those
    // would just move the problem behind a disclosure.
    for (const anchor of ['htmlFor="firmware-port"', 'htmlFor="firmware-profile"']) {
      expect(contextOf(anchor), `${anchor} is behind advanced`).not.toContain('advancedOpen')
    }
  })
})
