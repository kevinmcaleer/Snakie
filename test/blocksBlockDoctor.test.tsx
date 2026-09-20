// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import * as Blockly from 'blockly/core'
import 'blockly/blocks'
import {
  installBlockDoctor,
  renderExplanation,
  renderIdle
} from '../src/renderer/src/lib/blocks/block-doctor'
import { explainBlock } from '../src/renderer/src/lib/blocks/explain'
import { installCorePalette } from '../src/renderer/src/lib/blocks/palette'
import { installBlockDefinitions, resetBlockRegistry } from '../src/renderer/src/lib/blocks/registry'

/**
 * THE *WHAT BLOCK IS THIS?* ZONE (#1245).
 * =============================================================================
 *
 * Two promises, and both are checked here rather than by dragging blocks around
 * a real canvas:
 *
 *  - Asking never edits. `shouldPreventMove` is the whole guarantee that a
 *    learner can interrogate somebody else's program without taking it apart,
 *    and a `false` here would be a silent, destructive regression.
 *  - The answer is the explanation. The panel renders `explain.ts`'s facts and
 *    invents none, so what reaches the screen can be read back out of it.
 */

beforeEach(() => {
  resetBlockRegistry()
  installCorePalette()
  installBlockDefinitions()
  document.body.replaceChildren()
})

/** The two things `installBlockDoctor` asks of a workspace, and nothing else. */
function fakeWorkspace(host: HTMLElement): {
  ws: Blockly.WorkspaceSvg
  components: Map<string, { component: unknown; capabilities: unknown[] }>
} {
  const components = new Map<string, { component: unknown; capabilities: unknown[] }>()
  const manager = {
    addComponent: (info: { component: { id: string }; capabilities: unknown[] }) =>
      components.set(info.component.id, info),
    removeComponent: (id: string) => components.delete(id)
  }
  const ws = {
    getInjectionDiv: () => host,
    getComponentManager: () => manager,
    getToolbox: () => ({ getWidth: () => 120 })
  } as unknown as Blockly.WorkspaceSvg
  return { ws, components }
}

function dropTarget(components: Map<string, { component: unknown }>): Blockly.IDragTarget & {
  onDrop: (d: unknown) => void
} {
  const entry = components.get('snakieBlockDoctor')
  expect(entry).toBeDefined()
  return entry!.component as Blockly.IDragTarget & { onDrop: (d: unknown) => void }
}

describe('the zone on a canvas', () => {
  it('puts its invitation up and registers itself as a drag target', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const { ws, components } = fakeWorkspace(host)
    const dispose = installBlockDoctor(ws)

    const panel = host.querySelector('.block-doctor')
    expect(panel?.textContent).toContain('What block is this?')
    expect(components.get('snakieBlockDoctor')?.capabilities).toEqual([
      Blockly.ComponentManager.Capability.DRAG_TARGET
    ])
    // Clear of the shelf: the injection div's left edge is behind the toolbox,
    // and a zone placed there is half-hidden under the category column.
    expect((panel as HTMLElement).style.left).toBe('132px')

    dispose()
    expect(host.querySelector('.block-doctor')).toBeNull()
    expect(components.size).toBe(0)
  })

  it('gives the block straight back — asking is never an edit', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const { ws, components } = fakeWorkspace(host)
    installBlockDoctor(ws)
    expect(dropTarget(components).shouldPreventMove({} as Blockly.IDraggable)).toBe(true)
  })

  it('answers for the block dropped on it', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const { ws, components } = fakeWorkspace(host)
    installBlockDoctor(ws)

    const workspace = new Blockly.Workspace()
    dropTarget(components).onDrop(workspace.newBlock('snakie_wait_seconds'))

    const text = host.querySelector('.block-doctor')?.textContent ?? ''
    expect(text).toContain('wait')
    expect(text).toContain('Wait')
    expect(text).toContain('time')
    expect(text).toContain('time.sleep(0)')
    expect(text).toContain('snakie_wait_seconds')
  })

  it('ignores anything that is not a block', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const { ws, components } = fakeWorkspace(host)
    installBlockDoctor(ws)
    dropTarget(components).onDrop({ id: 'a bubble' })
    expect(host.querySelector('.block-doctor')?.textContent).toContain('What block is this?')
  })
})

describe('the answer on screen', () => {
  it('offers the help article, and only when there is somewhere to send it', () => {
    const workspace = new Blockly.Workspace()
    const explanation = explainBlock(workspace.newBlock('snakie_wait_seconds'))
    expect(explanation.help).toBe('ref-timing')

    const root = document.createElement('div')
    const opened: string[] = []
    renderExplanation(root, explanation, (article) => opened.push(article))
    const button = root.querySelector('.block-doctor__help') as HTMLButtonElement
    button.click()
    expect(opened).toEqual(['ref-timing'])

    const bare = document.createElement('div')
    renderExplanation(bare, explanation)
    expect(bare.querySelector('.block-doctor__help')).toBeNull()
  })

  it('says it does not know rather than guessing', () => {
    Blockly.defineBlocksWithJsonArray([
      { type: 'doctor_unknown', message0: 'from a part you have not installed' }
    ])
    const workspace = new Blockly.Workspace()
    const root = document.createElement('div')
    renderExplanation(root, explainBlock(workspace.newBlock('doctor_unknown')))
    expect(root.textContent).toContain('no description')
    expect(root.querySelector('.block-doctor__chips')).toBeNull()
  })

  it('closes back to the invitation', () => {
    const workspace = new Blockly.Workspace()
    const root = document.createElement('div')
    renderExplanation(root, explainBlock(workspace.newBlock('snakie_wait_seconds')))
    ;(root.querySelector('.block-doctor__close') as HTMLButtonElement).click()
    expect(root.textContent).toContain('What block is this?')
    expect(root.className).toContain('block-doctor--idle')
  })

  it('starts idle', () => {
    const root = document.createElement('div')
    renderIdle(root)
    expect(root.className).toContain('block-doctor--idle')
  })
})
