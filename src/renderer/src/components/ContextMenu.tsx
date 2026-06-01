import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import './ContextMenu.css'

/**
 * Reusable right-click context menu (issue #19).
 *
 * Rendered at an absolute screen position (typically the cursor), it closes on
 * outside-click, Escape, scroll, or window blur, and is keyboard-navigable
 * (Up/Down to move between enabled items, Enter/Space to activate, Escape to
 * dismiss). Disabled items are skipped during keyboard navigation and are not
 * activatable. Items with `danger: true` are styled as destructive actions.
 *
 * Co-located styling lives in `ContextMenu.css`. The component is intentionally
 * dependency-free so both file trees can share a single, consistent menu.
 */

/** A single actionable row in the context menu. */
export interface ContextMenuItem {
  /** Stable identity for the row. */
  key: string
  /** Visible label. */
  label: string
  /** Invoked when the item is activated. */
  onSelect: () => void
  /** When true the item is shown but cannot be activated or focused. */
  disabled?: boolean
  /** When true the item is rendered as a destructive (red) action. */
  danger?: boolean
}

/** Screen coordinates (clientX/clientY) at which to anchor the menu. */
export interface ContextMenuPosition {
  x: number
  y: number
}

interface ContextMenuProps {
  position: ContextMenuPosition
  items: ContextMenuItem[]
  /** Request the menu be closed (outside-click, Escape, after activation). */
  onClose: () => void
}

export function ContextMenu({ position, items, onClose }: ContextMenuProps): JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null)
  const [coords, setCoords] = useState<ContextMenuPosition>(position)
  // Index of the keyboard-focused item (-1 = nothing focused yet).
  const [activeIndex, setActiveIndex] = useState<number>(-1)

  const enabledIndexes = items.reduce<number[]>((acc, item, idx) => {
    if (!item.disabled) acc.push(idx)
    return acc
  }, [])

  // Clamp the menu inside the viewport after layout so it never overflows the
  // window edges (e.g. when right-clicking near the bottom/right).
  useLayoutEffect(() => {
    const el = menuRef.current
    if (!el) return
    const { offsetWidth: w, offsetHeight: h } = el
    const margin = 4
    let { x, y } = position
    if (x + w + margin > window.innerWidth) x = Math.max(margin, window.innerWidth - w - margin)
    if (y + h + margin > window.innerHeight) y = Math.max(margin, window.innerHeight - h - margin)
    setCoords({ x, y })
  }, [position])

  // Focus the menu container so it receives keyboard events immediately.
  useEffect(() => {
    menuRef.current?.focus()
  }, [])

  // Dismiss on outside interactions.
  useEffect(() => {
    const onPointerDown = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose()
    }
    const onScroll = (): void => onClose()
    const onBlur = (): void => onClose()
    // `capture` so we see the event before it is potentially stopped.
    window.addEventListener('mousedown', onPointerDown, true)
    window.addEventListener('contextmenu', onPointerDown, true)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('mousedown', onPointerDown, true)
      window.removeEventListener('contextmenu', onPointerDown, true)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('blur', onBlur)
    }
  }, [onClose])

  const activate = useCallback(
    (item: ContextMenuItem): void => {
      if (item.disabled) return
      onClose()
      item.onSelect()
    },
    [onClose]
  )

  const moveFocus = useCallback(
    (delta: number): void => {
      if (enabledIndexes.length === 0) return
      setActiveIndex((current) => {
        const pos = enabledIndexes.indexOf(current)
        if (pos === -1) {
          return delta > 0 ? enabledIndexes[0] : enabledIndexes[enabledIndexes.length - 1]
        }
        const next = (pos + delta + enabledIndexes.length) % enabledIndexes.length
        return enabledIndexes[next]
      })
    },
    [enabledIndexes]
  )

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>): void => {
      switch (e.key) {
        case 'Escape':
          e.preventDefault()
          onClose()
          break
        case 'ArrowDown':
          e.preventDefault()
          moveFocus(1)
          break
        case 'ArrowUp':
          e.preventDefault()
          moveFocus(-1)
          break
        case 'Home':
          e.preventDefault()
          if (enabledIndexes.length) setActiveIndex(enabledIndexes[0])
          break
        case 'End':
          e.preventDefault()
          if (enabledIndexes.length) setActiveIndex(enabledIndexes[enabledIndexes.length - 1])
          break
        case 'Enter':
        case ' ': {
          e.preventDefault()
          const item = items[activeIndex]
          if (item) activate(item)
          break
        }
        default:
          break
      }
    },
    [activate, activeIndex, enabledIndexes, items, moveFocus, onClose]
  )

  return (
    <div
      ref={menuRef}
      className="context-menu"
      style={{ left: coords.x, top: coords.y }}
      role="menu"
      tabIndex={-1}
      aria-orientation="vertical"
      onKeyDown={onKeyDown}
      // Prevent a native context menu from appearing over our own menu.
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, idx) => (
        <button
          key={item.key}
          type="button"
          role="menuitem"
          className={`context-menu__item${item.danger ? ' context-menu__item--danger' : ''}${
            idx === activeIndex ? ' is-active' : ''
          }`}
          disabled={item.disabled}
          aria-disabled={item.disabled || undefined}
          onMouseEnter={() => !item.disabled && setActiveIndex(idx)}
          onClick={() => activate(item)}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
