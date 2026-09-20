// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { AdvancedBlocksToggle } from '../src/renderer/src/components/AdvancedBlocksToggle'

/**
 * "SHOW ADVANCED BLOCKS" IS NOT A CATEGORY (#1211).
 * =============================================================================
 *
 * The switch lives at the foot of Blockly's toolbox column, and that is exactly
 * what went wrong: pressing it also opened the Turtle flyout, because the press
 * reached the toolbox. Two routes, and the toggle closes the one it owns —
 * the browser's mousedown default, which focuses the nearest focusable
 * ancestor. In the app that ancestor is Blockly's tabbable toolbox root, and
 * focusing the root of a focus tree makes Blockly select its first category.
 *
 * (The other route — Blockly's own `pointerdown` listener on the column — is
 * stopped natively on the shelf foot in `BlocksCanvas`, above React's
 * root-delegated handlers; it cannot be closed from the component.)
 */
// React's `act` wants to be told it is in a test environment.
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('the advanced-blocks switch', () => {
  let host: HTMLElement
  let toolbox: HTMLElement

  beforeEach(() => {
    document.body.replaceChildren()
    // A stand-in for Blockly's toolbox column: tabbable, like the real one.
    toolbox = document.createElement('div')
    toolbox.tabIndex = 0
    host = document.createElement('div')
    toolbox.append(host)
    document.body.append(toolbox)
  })

  function render(level: 'simple' | 'advanced', onChange: (l: string) => void): void {
    const root = createRoot(host)
    act(() => {
      root.render(<AdvancedBlocksToggle level={level} onChange={onChange} inShelf />)
    })
  }

  it('does not let a press focus the toolbox around it', () => {
    render('simple', () => {})
    const label = host.querySelector('label')!
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    act(() => {
      label.dispatchEvent(down)
    })
    expect(down.defaultPrevented).toBe(true)
    // Which is what keeps focus — and so Blockly's category selection — away
    // from the toolbox the switch happens to sit in.
    expect(document.activeElement).not.toBe(toolbox)
  })

  it('still toggles the setting when clicked', () => {
    const seen: string[] = []
    render('simple', (l) => seen.push(l))
    const input = host.querySelector<HTMLInputElement>('.blocks-advanced__input')!
    act(() => {
      input.click()
    })
    expect(seen).toEqual(['advanced'])
  })

  it('turns the setting back off', () => {
    const seen: string[] = []
    render('advanced', (l) => seen.push(l))
    const input = host.querySelector<HTMLInputElement>('.blocks-advanced__input')!
    act(() => {
      input.click()
    })
    expect(seen).toEqual(['simple'])
  })
})
