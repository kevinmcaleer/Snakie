// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { BuildEmptyState, BUILD_EMPTY_COLLAPSED_KEY } from '../src/renderer/src/components/BuildEmptyState'
import { bettercadNewRobotUrl } from '../src/shared/links'

/**
 * The Build workspace's "no robot yet" card: New robot / Open URDF / design it
 * in BetterCAD, tucked into a pill by ×, and the pill brings it back.
 */
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('BuildEmptyState', () => {
  let host: HTMLElement
  let root: Root
  const openExternal = vi.fn(() => Promise.resolve())
  const onNewRobot = vi.fn()
  const onOpenRobot = vi.fn()

  const render = (): void => {
    act(() => root.render(<BuildEmptyState onNewRobot={onNewRobot} onOpenRobot={onOpenRobot} />))
  }
  const button = (text: string): HTMLButtonElement => {
    const b = [...host.querySelectorAll('button')].find((el) => el.textContent?.includes(text))
    if (!b) throw new Error(`no button "${text}"`)
    return b
  }

  beforeEach(() => {
    window.localStorage.clear()
    document.body.replaceChildren()
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    openExternal.mockClear()
    onNewRobot.mockClear()
    onOpenRobot.mockClear()
    ;(window as unknown as { api: unknown }).api = { openExternal }
  })

  it('offers New robot and Open URDF', () => {
    render()
    act(() => button('New robot').click())
    act(() => button('Open URDF').click())
    expect(onNewRobot).toHaveBeenCalledOnce()
    expect(onOpenRobot).toHaveBeenCalledOnce()
  })

  it('opens BetterCAD, saying Snakie sent the visitor', () => {
    render()
    expect(host.textContent).toContain('by kevsrobots')
    act(() => button('Design it in BetterCAD').click())
    expect(openExternal).toHaveBeenCalledWith(bettercadNewRobotUrl())
    expect(bettercadNewRobotUrl()).toBe('https://bettercad.kevsrobots.com/?from=snakie')
  })

  it('tucks into a pill that is remembered, and the pill brings it back', () => {
    render()
    act(() => button('×').click())
    expect(host.querySelector('.buildempty')).toBeNull()
    expect(window.localStorage.getItem(BUILD_EMPTY_COLLAPSED_KEY)).toBe('true')
    act(() => button('Start your robot').click())
    expect(host.querySelector('.buildempty')).not.toBeNull()
  })
})
