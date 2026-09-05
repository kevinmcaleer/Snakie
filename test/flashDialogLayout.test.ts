import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * The flash dialog's layout, and the stacking that made the gallery useless
 * (#896, and a regression in #893).
 *
 * The z-index one is the important test here. The Board Finder was given
 * `z-index: 200` — copied from the Parts Catalog, where it opens from a panel
 * with nothing above it. But the gallery is now reached from a button INSIDE
 * the flash dialog, whose overlay is 1100. So it opened behind the dialog that
 * launched it, invisible and unreachable, with the dialog still modal in front
 * of it. Two correct-looking numbers from two different contexts.
 */

const flasherCss = readFileSync('src/renderer/src/components/FirmwareFlasher.css', 'utf8')
const finderCss = readFileSync('src/renderer/src/components/BoardFinder.css', 'utf8')
const tsx = readFileSync('src/renderer/src/components/FirmwareFlasher.tsx', 'utf8')

/** The `z-index` of the first rule for `selector` in `css`. */
function zIndexOf(css: string, selector: string): number {
  const at = css.indexOf(selector)
  expect(at, `${selector} not found`).toBeGreaterThan(-1)
  const block = css.slice(at, css.indexOf('}', at))
  const m = /z-index:\s*(\d+)/.exec(block)
  expect(m, `no z-index on ${selector}`).not.toBeNull()
  return Number(m![1])
}

describe('the Board Finder is reachable once opened', () => {
  it('stacks ABOVE the dialog that opens it', () => {
    // It is launched from the button beside Detect board. Anything at or below
    // the overlay's z-index puts it behind a modal and traps the user.
    const finder = zIndexOf(finderCss, '.bfind {')
    const overlay = zIndexOf(flasherCss, '.firmware-overlay {')
    expect(finder).toBeGreaterThan(overlay)
  })

  it('stays BELOW the progress dialog, which reports work in flight', () => {
    const finder = zIndexOf(finderCss, '.bfind {')
    const transfer = zIndexOf(
      readFileSync('src/renderer/src/components/TransferProgressDialog.css', 'utf8'),
      '.transfer__backdrop {'
    )
    expect(finder).toBeLessThan(transfer)
  })
})

describe('the Board row (#896)', () => {
  it('puts Detect and Board Finder to the RIGHT of the dropdown', () => {
    // The dropdown is the answer; the buttons are two ways of supplying it. The
    // buttons used to float above the label they act on.
    const row = tsx.indexOf('firmware-detect-row')
    const select = tsx.indexOf('id="firmware-profile"')
    const detect = tsx.indexOf('⟳ Detect board')
    const finder = tsx.indexOf('⌕ Board Finder')
    expect(row).toBeLessThan(select)
    expect(select).toBeLessThan(detect)
    expect(detect).toBeLessThan(finder)
  })

  it('lets the board name give way, not the button labels', () => {
    const at = flasherCss.indexOf('.firmware-detect-row .firmware-select')
    const block = flasherCss.slice(at, flasherCss.indexOf('}', at))
    expect(block).toContain('flex: 1 1')
    expect(block).toContain('min-width: 0')
  })
})

describe('Family and Model side by side (#896)', () => {
  it('is two columns', () => {
    const at = flasherCss.indexOf('.firmware-cols {')
    const block = flasherCss.slice(at, flasherCss.indexOf('}', at))
    expect(block).toContain('grid-template-columns')
    // `minmax(0, 1fr)`, not `1fr`: a grid track's default `min-width: auto`
    // refuses to shrink below its widest option, and some model names are long
    // enough to push the second column off the dialog.
    expect(block).toContain('minmax(0, 1fr)')
  })

  it('collapses to one column when two would be too tight', () => {
    expect(flasherCss).toMatch(/@media \(max-width: 30rem\)[\s\S]*?grid-template-columns: 1fr/)
  })

  it('keeps Family before Model, since Family narrows Model', () => {
    const family = tsx.indexOf('id="firmware-cat-family"')
    const model = tsx.indexOf('id="firmware-cat-model"')
    expect(family).toBeLessThan(model)
  })
})
