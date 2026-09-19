import { describe, it, expect, beforeEach } from 'vitest'
import * as Blockly from 'blockly/core'
import {
  DUPLICATE_SHORTCUT,
  duplicateFocused,
  installDuplicateShortcut
} from '../src/renderer/src/lib/blocks/duplicate'

/**
 * ⌘D / CTRL+D DUPLICATES THE SELECTED BLOCK (#1117, epic #1007).
 * =============================================================================
 *
 * Blockly binds duplicate to a bare `D`, which nobody guesses, and to the
 * right-click menu, which is two gestures. The key everyone tries is ⌘D — and
 * in the web build that is the browser's "bookmark this page", so the shortcut
 * has to CLAIM the key rather than merely listen for it.
 *
 * Node, so no canvas: what is tested here is the wiring — which keys reach us,
 * what we do with an event we accept, and that a second canvas mounting does
 * not throw on a registry that is global. The copy itself is Blockly's own
 * clipboard.
 */

/** A workspace stand-in: the four things the precondition asks about. */
function fakeWorkspace(
  over: Partial<{ dragging: boolean; readOnly: boolean; flyout: boolean }> = {}
): Blockly.WorkspaceSvg {
  return {
    isDragging: () => over.dragging === true,
    isReadOnly: () => over.readOnly === true,
    isFlyout: over.flyout === true
  } as unknown as Blockly.WorkspaceSvg
}

/** A keydown whose `preventDefault` we can see. */
function fakeEvent(): KeyboardEvent & { prevented: boolean } {
  const event = {
    prevented: false,
    preventDefault(): void {
      event.prevented = true
    }
  }
  return event as unknown as KeyboardEvent & { prevented: boolean }
}

/** Something `isCopyable` accepts — a block stand-in with nothing to copy. */
const uncopyableNode = { toCopyData: () => null }

/**
 * A shortcut scope around `node`.
 *
 * Cast because a real `focusedNode` is a whole `IFocusableNode` — five methods
 * about DOM focus that none of this reads. What a duplicate asks of it is
 * `toCopyData`, and that is what these stubs answer.
 */
const focusOn = (node: unknown): Blockly.ContextMenuRegistry.Scope =>
  ({ focusedNode: node }) as unknown as Blockly.ContextMenuRegistry.Scope

const shortcut = (): Blockly.ShortcutRegistry.KeyboardShortcut =>
  Blockly.ShortcutRegistry.registry.getRegistry()[DUPLICATE_SHORTCUT]

beforeEach(() => {
  installDuplicateShortcut()
})

describe('the key a child actually presses (#1117)', () => {
  it('claims Ctrl+D', () => {
    const key = Blockly.ShortcutRegistry.registry.createSerializedKey(
      Blockly.utils.KeyCodes.D,
      [Blockly.utils.KeyCodes.CTRL]
    )
    expect(Blockly.ShortcutRegistry.registry.getShortcutNamesByKeyCode(key)).toContain(
      DUPLICATE_SHORTCUT
    )
  })

  it('and ⌘D, which is the same shortcut on a Mac', () => {
    const key = Blockly.ShortcutRegistry.registry.createSerializedKey(
      Blockly.utils.KeyCodes.D,
      [Blockly.utils.KeyCodes.META]
    )
    expect(Blockly.ShortcutRegistry.registry.getShortcutNamesByKeyCode(key)).toContain(
      DUPLICATE_SHORTCUT
    )
  })

  it('leaves Blockly’s own bare-D duplicate alone', () => {
    // Keyboard navigation (epic #188) binds `D` on its own. Ours is a different
    // serialized key, so both live.
    expect(
      Blockly.ShortcutRegistry.registry.getShortcutNamesByKeyCode(
        String(Blockly.utils.KeyCodes.D)
      )
    ).toContain('duplicate')
  })

  it('installs again without throwing — a canvas mounts per file', () => {
    expect(() => {
      installDuplicateShortcut()
      installDuplicateShortcut()
    }).not.toThrow()
    const ctrl = Blockly.ShortcutRegistry.registry.createSerializedKey(
      Blockly.utils.KeyCodes.D,
      [Blockly.utils.KeyCodes.CTRL]
    )
    // And is still mapped exactly once, rather than three times over.
    const named = Blockly.ShortcutRegistry.registry.getShortcutNamesByKeyCode(ctrl) ?? []
    expect(named.filter((n) => n === DUPLICATE_SHORTCUT)).toHaveLength(1)
  })
})

describe('the browser does not get the key (#1117)', () => {
  it('preventDefault runs even when there is nothing to duplicate', () => {
    // The failure this guards is specific: in the web build an unhandled ⌘D
    // opens the bookmark dialog over the canvas. Whether we found something to
    // copy is not the browser's business.
    const event = fakeEvent()
    shortcut().callback?.(fakeWorkspace(), event, shortcut(), focusOn(uncopyableNode))
    expect(event.prevented).toBe(true)
  })

  it('and the shortcut reports it did nothing, so nothing else is suppressed', () => {
    const handled = shortcut().callback?.(
      fakeWorkspace(),
      fakeEvent(),
      shortcut(),
      focusOn(uncopyableNode)
    )
    expect(handled).toBe(false)
  })
})

describe('when duplicate is offered at all (#1117)', () => {
  const scope = focusOn(uncopyableNode)

  it('not while a block is mid-drag', () => {
    expect(shortcut().preconditionFn?.(fakeWorkspace({ dragging: true }), scope)).toBe(false)
  })

  it('not in a read-only workspace — the course peek pane', () => {
    expect(shortcut().preconditionFn?.(fakeWorkspace({ readOnly: true }), scope)).toBe(false)
  })

  it('not in the flyout: that shelf is a menu, not the program', () => {
    expect(shortcut().preconditionFn?.(fakeWorkspace({ flyout: true }), scope)).toBe(false)
  })

  it('not with nothing selected', () => {
    expect(shortcut().preconditionFn?.(fakeWorkspace(), focusOn(undefined))).toBe(false)
  })

  it('yes for a copyable node on an ordinary workspace', () => {
    expect(shortcut().preconditionFn?.(fakeWorkspace(), scope)).toBe(true)
  })
})

describe('duplicateFocused (#1117)', () => {
  it('is a no-op when nothing is focused or selected', () => {
    expect(duplicateFocused(fakeWorkspace(), { focusedNode: undefined })).toBe(false)
  })

  it('and when the focused thing has nothing to copy', () => {
    // An insertion marker answers `null` here, and pasting `null` would throw
    // inside Blockly rather than quietly doing nothing.
    expect(duplicateFocused(fakeWorkspace(), { focusedNode: uncopyableNode })).toBe(false)
  })

  it('ignores something that is not copyable at all', () => {
    expect(duplicateFocused(fakeWorkspace(), { focusedNode: { id: 'not-a-block' } })).toBe(false)
  })
})
