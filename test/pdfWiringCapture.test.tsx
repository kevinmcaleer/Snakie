// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

// React 18 wants to be told it is under test before `act` will flush quietly.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/**
 * THE ELECTRONICS PAGE HAS TO BE IN THE DOCUMENT.
 *
 * The export photographs a board that is usually not on screen — the learner
 * presses print from Blocks or Code. It used to render its own `<BoardPane>` in
 * a React root of its own, which is a TREE of its own: no `WorkspaceProvider`
 * above it, so the pane threw on its first render, the capture waited out its
 * twelve-second timeout, and every such export came out with no Electronics
 * page in it (and no sheet page either).
 *
 * The app mounts the pane now, inside its providers. These are the three
 * things that has to keep being true.
 */

const SRC = (p: string): string =>
  readFileSync(join(__dirname, '..', 'src', 'renderer', 'src', p), 'utf-8')

vi.mock('../src/renderer/src/components/BoardPane', () => ({
  default: (): JSX.Element => <svg className="wc__svg" />
}))

import { BoardCaptureHost } from '../src/renderer/src/components/BoardCaptureHost'
import {
  mountCaptureBoard,
  registerBoardCaptureMount,
  resetBoardCaptureRegistry
} from '../src/renderer/src/components/board-capture-registry'

describe('the registry the exporter asks for a board', () => {
  afterEach(() => resetBoardCaptureRegistry())

  it('answers null when there is no app tree to mount one in', () => {
    expect(mountCaptureBoard(document.createElement('div'))).toBeNull()
  })

  it('hands the caller the mount it registered, and the undo', () => {
    const unmount = vi.fn()
    const mount = vi.fn(() => unmount)
    const undo = registerBoardCaptureMount(mount)
    const host = document.createElement('div')

    expect(mountCaptureBoard(host)).toBe(unmount)
    expect(mount).toHaveBeenCalledWith(host)

    undo()
    expect(mountCaptureBoard(host)).toBeNull()
  })

  it("a stale undo cannot unregister the host that replaced it", () => {
    const first = vi.fn(() => vi.fn())
    const second = vi.fn(() => vi.fn())
    const undoFirst = registerBoardCaptureMount(first)
    registerBoardCaptureMount(second)

    undoFirst()
    mountCaptureBoard(document.createElement('div'))
    expect(second).toHaveBeenCalled()
  })
})

describe('BoardCaptureHost', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    resetBoardCaptureRegistry()
  })

  it('renders nothing until an export asks, then puts a board in the host', async () => {
    await act(async () => {
      root.render(<BoardCaptureHost />)
    })
    expect(container.innerHTML).toBe('') // nothing until asked

    const host = document.createElement('div')
    document.body.appendChild(host)
    let unmount: (() => void) | null = null
    await act(async () => {
      unmount = mountCaptureBoard(host)
    })

    expect(unmount).toBeTypeOf('function')
    // The pane goes into the HOST, not the app's own DOM.
    expect(host.querySelector('svg.wc__svg')).not.toBeNull()
    expect(container.innerHTML).toBe('')

    await act(async () => unmount?.())
    expect(host.querySelector('svg.wc__svg')).toBeNull()
    host.remove()
  })
})

describe('where the board is mounted from', () => {
  it('the capture asks the app rather than opening a React root of its own', () => {
    const capture = SRC('lib/pdf/wiring-capture.ts')
    expect(capture).toContain('mountCaptureBoard(host)')
    // A root of its own is a tree of its own — no providers, and a pane that
    // throws where nothing can see it.
    expect(capture).not.toContain('createRoot')
    expect(capture).not.toContain('react-dom/client')
  })

  it('the host renders inside the app providers, where a workspace exists', () => {
    const app = SRC('App.tsx')
    const inProviders = app.slice(
      app.indexOf('<WorkspaceProvider>'),
      app.indexOf('</WorkspaceProvider>')
    )
    expect(inProviders).toContain('<BoardCaptureHost />')
  })
})
