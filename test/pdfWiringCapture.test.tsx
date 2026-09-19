// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

// React 18 wants to be told it is under test before `act` will flush quietly.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/**
 * THE ELECTRONICS PAGE HAS TO BE IN THE DOCUMENT, AND HAVE THE WIRING ON IT.
 *
 * Two failures, one page. The export photographs a board that is usually not on
 * screen — the learner presses print from Blocks or Code:
 *
 *  - It used to render that board in a React root of its own, which is a TREE of
 *    its own: no `WorkspaceProvider` above it, so the pane threw on its first
 *    render and the page was left out of the document altogether (#1147).
 *  - Then it photographed the board before its part libraries had arrived, when
 *    every placed part is still a `part library not installed` box with no pins
 *    — so the page came out with placeholder cards and NO WIRES, which is the
 *    most important thing on it (#1168).
 *
 * The app mounts the pane now, inside its providers, on the white print mat, and
 * the capture waits for the pane to say it has everything.
 */

const SRC = (p: string): string =>
  readFileSync(join(__dirname, '..', 'src', 'renderer', 'src', p), 'utf-8')

vi.mock('../src/renderer/src/components/BoardPane', () => ({
  default: ({ mat }: { mat?: string }): JSX.Element => (
    <section data-breadboard-bg={mat} data-board-ready="">
      <svg className="wc__svg" />
    </section>
  )
}))

import { BoardCaptureHost } from '../src/renderer/src/components/BoardCaptureHost'
import {
  mountCaptureBoard,
  registerBoardCaptureMount,
  resetBoardCaptureRegistry
} from '../src/renderer/src/components/board-capture-registry'

describe('the parts the photographed board can draw', () => {
  it('resolves a placed part by id when its library is renamed or not installed', () => {
    // The BOM already did this (#1170); the canvas drew a `part library not
    // installed` box for the same part until it went through the same helper.
    const canvas = SRC('components/WiringCanvas.tsx')
    expect(canvas).toContain('findPart(libraries, lib, part)')
    expect(canvas).not.toMatch(/libraries\.find\(\(l\) => l\.id === lib\)/)
  })
})

describe('the registry the exporter asks for a board', () => {
  afterEach(() => resetBoardCaptureRegistry())

  it('answers null when there is no app tree to mount one in', () => {
    expect(mountCaptureBoard(document.createElement('div'), 'white')).toBeNull()
  })

  it('hands the caller the mount it registered, with the mat it asked for', () => {
    const unmount = vi.fn()
    const mount = vi.fn(() => unmount)
    const undo = registerBoardCaptureMount(mount)
    const host = document.createElement('div')

    expect(mountCaptureBoard(host, 'white')).toBe(unmount)
    expect(mount).toHaveBeenCalledWith(host, 'white')

    undo()
    expect(mountCaptureBoard(host, 'white')).toBeNull()
  })

  it('a stale undo cannot unregister the host that replaced it', () => {
    const first = vi.fn(() => vi.fn())
    const second = vi.fn(() => vi.fn())
    const undoFirst = registerBoardCaptureMount(first)
    registerBoardCaptureMount(second)

    undoFirst()
    mountCaptureBoard(document.createElement('div'), 'white')
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
      unmount = mountCaptureBoard(host, 'white')
    })

    expect(unmount).toBeTypeOf('function')
    // The pane goes into the HOST, not the app's own DOM.
    expect(host.querySelector('svg.wc__svg')).not.toBeNull()
    expect(container.innerHTML).toBe('')

    await act(async () => unmount?.())
    expect(host.querySelector('svg.wc__svg')).toBeNull()
    host.remove()
  })

  it('dresses the board in the mat the export asked for, scoped to the host', async () => {
    await act(async () => {
      root.render(<BoardCaptureHost />)
    })
    const host = document.createElement('div')
    document.body.appendChild(host)
    await act(async () => {
      mountCaptureBoard(host, 'white')
    })
    expect(host.querySelector('[data-breadboard-bg="white"]')).not.toBeNull()
    // The window's own mat is untouched — the learner's canvas doesn't flash.
    expect(document.documentElement.hasAttribute('data-breadboard-bg')).toBe(false)
    host.remove()
  })
})

describe('where the board is mounted from, and when it is photographed', () => {
  it('the capture asks the app rather than opening a React root of its own', () => {
    const capture = SRC('lib/pdf/wiring-capture.ts')
    expect(capture).toContain('mountCaptureBoard(host, PRINT_MAT)')
    // A root of its own is a tree of its own — no providers, and a pane that
    // throws where nothing can see it.
    expect(capture).not.toContain('createRoot')
    expect(capture).not.toContain('react-dom/client')
  })

  it('waits for a board that is READY before it starts measuring it', () => {
    const capture = SRC('lib/pdf/wiring-capture.ts')
    // The placeholder frame — parts with no pins, and so no wires — is stable
    // for as long as the libraries take, so stability alone never ruled it out.
    expect(capture).toContain('data-board-ready')
    const body = capture.slice(capture.indexOf('export async function captureWiring'))
    expect(body.indexOf('await ready(host, deadline)')).toBeLessThan(body.indexOf('await settle('))
  })

  it('prints on the white mat, not on whatever the window is set to', () => {
    const capture = SRC('lib/pdf/wiring-capture.ts')
    expect(capture).toContain("export const PRINT_MAT = 'white'")
    expect(capture).toContain("export const PRINT_BACKGROUND = '#ffffff'")
    // The picture in the document must not depend on which tab printed it, so
    // the canvas on screen is never the one photographed.
    expect(capture).not.toContain('getWiringSvg')
    expect(SRC('lib/pdf/project-art.ts')).toContain('captureWiring(PRINT_BACKGROUND')
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

describe('the pane says when it is ready (#1168)', () => {
  it('is ready only once BOTH robot.yml and the part libraries have landed', () => {
    const pane = SRC('components/BoardPane.tsx')
    expect(pane).toContain('const ready = robotLoaded && librariesLoaded')
    // `.finally`, not `.then`: a library list that fails to load still settles,
    // and a capture that waits forever is a document with no wiring page.
    expect(pane).toContain('.finally(() => setLibrariesLoaded(true))')
    expect(pane).toContain("data-board-ready={ready ? '' : undefined}")
  })

  it('a pane given its own mat leaves the document root alone', () => {
    const pane = SRC('components/BoardPane.tsx')
    const effect = pane.slice(pane.indexOf('const { breadboardBg }'), pane.indexOf('// User-authored boards'))
    expect(effect).toContain('if (mat) return')
    expect(pane).toContain('data-breadboard-bg={mat}')
  })

  it('the mat skins match on any ancestor, so a scoped one dresses one canvas', () => {
    const css = readFileSync(
      join(__dirname, '..', 'src', 'renderer', 'src', 'components', 'WiringCanvas.css'),
      'utf-8'
    )
    expect(css).toContain("[data-breadboard-bg='white'] .wc--lifelike .wc__stage")
    expect(css).not.toContain(':root[data-breadboard-bg')
  })
})
