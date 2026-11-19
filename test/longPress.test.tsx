// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { LONG_PRESS_MS, LONG_PRESS_SLOP, useLongPress, type MenuAnchorEvent } from '../src/renderer/src/hooks/useLongPress'

/**
 * Press-and-hold opens the same menu a right-click does. iOS Safari sends no
 * `contextmenu` for a held finger, so without this the Build tree's Rename /
 * Make base / Delete menu cannot be reached on an iPhone or iPad.
 */
function Row({ onMenu, onClick }: { onMenu: (e: MenuAnchorEvent) => void; onClick: () => void }): JSX.Element {
  const press = useLongPress(onMenu)
  return (
    <div id="row" {...press}>
      <button id="name" onClick={onClick}>
        thigh_left
      </button>
    </div>
  )
}

let host: HTMLDivElement
let root: Root
const onMenu = vi.fn()
const onClick = vi.fn()

const pointer = (type: string, pointerType: string, x = 100, y = 200): void => {
  const e = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y })
  Object.defineProperty(e, 'pointerType', { value: pointerType })
  act(() => void host.querySelector('#name')!.dispatchEvent(e))
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers()
  onMenu.mockReset()
  onClick.mockReset()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root.render(<Row onMenu={onMenu} onClick={onClick} />))
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.useRealTimers()
})

describe('useLongPress', () => {
  it('opens the menu at the finger after a hold', () => {
    pointer('pointerdown', 'touch', 120, 340)
    act(() => void vi.advanceTimersByTime(LONG_PRESS_MS - 1))
    expect(onMenu).not.toHaveBeenCalled()
    act(() => void vi.advanceTimersByTime(1))
    expect(onMenu).toHaveBeenCalledTimes(1)
    expect(onMenu.mock.calls[0][0]).toMatchObject({ clientX: 120, clientY: 340 })
  })

  it('does not fire for a tap', () => {
    pointer('pointerdown', 'touch')
    act(() => void vi.advanceTimersByTime(100))
    pointer('pointerup', 'touch')
    act(() => void vi.advanceTimersByTime(LONG_PRESS_MS))
    expect(onMenu).not.toHaveBeenCalled()
  })

  it('does not fire when the finger scrolls the list', () => {
    pointer('pointerdown', 'touch', 100, 200)
    pointer('pointermove', 'touch', 100, 200 + LONG_PRESS_SLOP + 1)
    act(() => void vi.advanceTimersByTime(LONG_PRESS_MS))
    expect(onMenu).not.toHaveBeenCalled()
  })

  it('tolerates a finger that wobbles while it rests', () => {
    pointer('pointerdown', 'touch', 100, 200)
    pointer('pointermove', 'touch', 103, 204)
    act(() => void vi.advanceTimersByTime(LONG_PRESS_MS))
    expect(onMenu).toHaveBeenCalledTimes(1)
  })

  it('ignores a held mouse button — a mouse right-clicks', () => {
    pointer('pointerdown', 'mouse')
    act(() => void vi.advanceTimersByTime(LONG_PRESS_MS))
    expect(onMenu).not.toHaveBeenCalled()
    pointer('contextmenu', 'mouse', 50, 60)
    expect(onMenu).toHaveBeenCalledTimes(1)
  })

  it('swallows the click and the browser contextmenu that follow a hold', () => {
    pointer('pointerdown', 'touch')
    act(() => void vi.advanceTimersByTime(LONG_PRESS_MS))
    pointer('contextmenu', 'touch') // Android sends its own for the same hold
    pointer('pointerup', 'touch')
    pointer('click', 'touch') // …and lifting the finger "clicks" the row
    expect(onMenu).toHaveBeenCalledTimes(1)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('lets an ordinary tap click through', () => {
    pointer('pointerdown', 'touch')
    pointer('pointerup', 'touch')
    pointer('click', 'touch')
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})
