import { useEffect, useRef, type RefObject } from 'react'

/**
 * Accessibility focus trap for modal dialogs (issue #188).
 *
 * Wired into a dialog container ref, this hook gives `aria-modal` dialogs the
 * focus behaviour screen-reader and keyboard users expect:
 *
 *  1. **Initial focus** — on open, focus moves into the dialog (the first
 *     focusable control, or the container itself if it has none).
 *  2. **Trap** — Tab / Shift+Tab cycle within the dialog instead of escaping to
 *     the inert page behind it.
 *  3. **Restore** — on close, focus returns to whatever was focused when the
 *     dialog opened (typically the trigger button).
 *
 * The trap is keyed on `active`; pass `false` to disable it without unmounting
 * (e.g. while a flash is in progress and the dialog must stay put).
 *
 * @param active  whether the trap is engaged (usually "the dialog is open").
 * @returns a ref to attach to the dialog container element.
 */
export function useFocusTrap<T extends HTMLElement = HTMLDivElement>(
  active = true
): RefObject<T> {
  const containerRef = useRef<T>(null)

  useEffect(() => {
    if (!active) return undefined
    const container = containerRef.current
    if (!container) return undefined

    // Remember the trigger so focus can be restored when the dialog closes.
    const previouslyFocused = document.activeElement as HTMLElement | null

    const focusable = (): HTMLElement[] =>
      Array.from(
        container.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => el.offsetParent !== null || el === document.activeElement)

    // Move focus into the dialog. Prefer an already-focused control inside it
    // (e.g. an `autoFocus` button), else the first focusable, else the container.
    if (!container.contains(document.activeElement)) {
      const first = focusable()[0]
      if (first) {
        first.focus()
      } else {
        container.tabIndex = -1
        container.focus()
      }
    }

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Tab') return
      const items = focusable()
      if (items.length === 0) {
        // Nothing tabbable — keep focus pinned on the container.
        e.preventDefault()
        container.focus()
        return
      }
      const firstEl = items[0]
      const lastEl = items[items.length - 1]
      const activeEl = document.activeElement
      if (e.shiftKey) {
        if (activeEl === firstEl || !container.contains(activeEl)) {
          e.preventDefault()
          lastEl.focus()
        }
      } else if (activeEl === lastEl || !container.contains(activeEl)) {
        e.preventDefault()
        firstEl.focus()
      }
    }

    container.addEventListener('keydown', onKeyDown)
    return () => {
      container.removeEventListener('keydown', onKeyDown)
      // Restore focus to the trigger, if it's still in the document.
      if (previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus()
      }
    }
  }, [active])

  return containerRef
}
