import { beforeEach, describe, expect, it } from 'vitest'
import {
  getHierarchySelection,
  resetHierarchySelectionForTest,
  setHierarchySelection
} from '../src/renderer/src/components/hierarchy-selection'

/**
 * The shared hierarchy selection (#718, epic #720). The property that matters is
 * that ONE value backs both workspaces — the selection used to be `useState`
 * inside the wiring canvas and a second `useState` inside the Build view, so
 * selecting a part in Electronics and switching to Build landed you nowhere.
 *
 * Runs without a DOM (vitest's node environment): the store falls back to
 * in-memory when `window`/`localStorage` isn't there, which is exactly the
 * behaviour a browser with storage disabled gets.
 */

describe('hierarchy selection', () => {
  beforeEach(() => resetHierarchySelectionForTest())

  it('starts with nothing selected', () => {
    expect(getHierarchySelection()).toBeNull()
  })

  it('holds one value that every reader sees', () => {
    setHierarchySelection('s1')
    expect(getHierarchySelection()).toBe('s1')
  })

  it('clears on null', () => {
    setHierarchySelection('s1')
    setHierarchySelection(null)
    expect(getHierarchySelection()).toBeNull()
  })

  it('a later set wins — the value is the last one written, not the first', () => {
    setHierarchySelection('board')
    expect(getHierarchySelection()).toBe('board')
    setHierarchySelection('link:base_link')
    expect(getHierarchySelection()).toBe('link:base_link')
  })

  it('re-setting the same key is a no-op, not a churn', () => {
    setHierarchySelection('s1')
    setHierarchySelection('s1')
    expect(getHierarchySelection()).toBe('s1')
  })

  it('accepts every hierarchy key shape, including Build-only rows', () => {
    // A Build-only key has no counterpart in Electronics; the store must still
    // hold it, so switching back to Build restores what was selected there.
    for (const key of ['board', 'servo1', 'link:base_link', 'joint:SG90_joint']) {
      setHierarchySelection(key)
      expect(getHierarchySelection()).toBe(key)
    }
  })
})
