import { afterEach, describe, expect, it } from 'vitest'
import type * as Blockly from 'blockly/core'
import {
  getBlocksWorkspace,
  registerBlocksWorkspace,
  resetBlocksWorkspaceRegistry,
  subscribeBlocksWorkspace
} from '../src/renderer/src/lib/blocks/workspace-registry'

/**
 * The seam that lets anything outside `BlocksCanvas` reach the live workspace
 * (#1112) — the PDF export asks for a workspace rather than digging an injected
 * `<svg>` out of the DOM.
 */

/** The registry never looks inside a workspace; an opaque stand-in is enough. */
const ws = (name: string): Blockly.WorkspaceSvg => ({ name }) as unknown as Blockly.WorkspaceSvg

afterEach(() => resetBlocksWorkspaceRegistry())

describe('the blocks workspace registry', () => {
  it('has nothing when the Blocks view is not mounted', () => {
    expect(getBlocksWorkspace()).toBeNull()
  })

  it('publishes the workspace and takes it back again', () => {
    const a = ws('a')
    const unregister = registerBlocksWorkspace(a)
    expect(getBlocksWorkspace()).toBe(a)
    unregister()
    expect(getBlocksWorkspace()).toBeNull()
  })

  it('survives a remount, where the new workspace registers before the old unregisters', () => {
    const old = ws('old')
    const unregisterOld = registerBlocksWorkspace(old)
    const fresh = ws('fresh')
    registerBlocksWorkspace(fresh)
    // React's cleanup for the OLD canvas runs after the new one mounted; it must
    // not leave the registry empty while a workspace is on screen.
    unregisterOld()
    expect(getBlocksWorkspace()).toBe(fresh)
  })

  it('tells subscribers when a workspace comes and goes', () => {
    const seen: (string | null)[] = []
    const stop = subscribeBlocksWorkspace((w) =>
      seen.push(w ? (w as unknown as { name: string }).name : null)
    )
    const unregister = registerBlocksWorkspace(ws('a'))
    unregister()
    stop()
    registerBlocksWorkspace(ws('b'))
    expect(seen).toEqual(['a', null])
  })
})
