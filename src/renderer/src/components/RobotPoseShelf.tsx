import { useEffect, useState, type JSX } from 'react'
import type { ShelfPose } from './robot-animate'
import './RobotPoseShelf.css'

/**
 * POSE SHELF (Animate mode) — every saved pose as a picture you can press.
 *
 * Poses used to be a list of names in the sidebar, opened one at a time in a
 * dialog. Here they sit in a row just above the timeline: press one to put the
 * robot in it, press **Save pose** to keep what is on screen. Each card's menu
 * mirrors, duplicates, updates or deletes it, and its name is edited in place.
 */
export interface RobotPoseShelfProps {
  poses: ShelfPose[]
  /** Pose name → thumbnail image URL (missing while it is being drawn). */
  thumbs: Record<string, string>
  /** The pose the robot is in right now (last applied or saved), if any. */
  active: string | null
  /** The robot has left↔right joints, so a pose can be mirrored. */
  canMirror: boolean
  onSave: () => void
  onApply: (name: string) => void
  onRename: (name: string, next: string) => void
  onMirror: (name: string) => void
  onDuplicate: (name: string) => void
  /** Replace the pose with what is on screen now. */
  onUpdate: (name: string) => void
  onAddToTimeline: (name: string) => void
  onDelete: (name: string) => void
}

export function RobotPoseShelf({
  poses,
  thumbs,
  active,
  canMirror,
  onSave,
  onApply,
  onRename,
  onMirror,
  onDuplicate,
  onUpdate,
  onAddToTimeline,
  onDelete
}: RobotPoseShelfProps): JSX.Element {
  // The open card menu, and where its card sits on screen (the menu is `fixed`
  // so the row's sideways scroll can't clip it).
  const [menu, setMenu] = useState<string | null>(null)
  const [menuAt, setMenuAt] = useState<{ left: number; bottom: number }>({ left: 0, bottom: 0 })
  const [renaming, setRenaming] = useState<string | null>(null)

  // A press anywhere else, or Escape, closes the open card menu.
  useEffect(() => {
    if (!menu) return
    const onDown = (e: PointerEvent): void => {
      const t = e.target as HTMLElement | null
      if (!t?.closest('.poseshelf__menu, .poseshelf__more')) setMenu(null)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setMenu(null)
    }
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu])

  const run = (fn: () => void): void => {
    setMenu(null)
    fn()
  }

  return (
    <div className="poseshelf" aria-label="Poses">
      <span className="poseshelf__title">Poses</span>
      <div className="poseshelf__row">
        {poses.length === 0 && (
          <p className="poseshelf__empty">
            Drag the robot into a pose, then press Save pose. Saved poses appear here.
          </p>
        )}
        {poses.map((p) => {
          const on = active === p.name
          const open = menu === p.name
          return (
            <div className={`poseshelf__card${on ? ' is-active' : ''}`} key={p.name}>
              <button
                type="button"
                className="poseshelf__apply"
                onClick={() => onApply(p.name)}
                title={`Put the robot in “${p.name}”`}
                aria-label={`Apply pose ${p.name}`}
                aria-pressed={on}
              >
                {thumbs[p.name] ? (
                  <img className="poseshelf__thumb" src={thumbs[p.name]} alt="" draggable={false} />
                ) : (
                  <span className="poseshelf__thumb poseshelf__thumb--blank" aria-hidden="true" />
                )}
              </button>
              <div className="poseshelf__foot">
                {renaming === p.name ? (
                  <input
                    className="poseshelf__rename"
                    defaultValue={p.name}
                    aria-label={`Rename ${p.name}`}
                    autoFocus
                    onFocus={(e) => e.currentTarget.select()}
                    onBlur={(e) => {
                      setRenaming(null)
                      onRename(p.name, e.currentTarget.value)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.currentTarget.blur()
                      if (e.key === 'Escape') {
                        e.currentTarget.value = p.name
                        e.currentTarget.blur()
                      }
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className="poseshelf__name"
                    onClick={() => setRenaming(p.name)}
                    title="Rename this pose"
                  >
                    {p.name}
                  </button>
                )}
                <button
                  type="button"
                  className="poseshelf__more"
                  aria-haspopup="menu"
                  aria-expanded={open}
                  aria-label={`More for pose ${p.name}`}
                  title="More"
                  onClick={(e) => {
                    const card = (e.currentTarget.closest('.poseshelf__card') as HTMLElement).getBoundingClientRect()
                    setMenuAt({
                      left: Math.max(8, Math.min(card.left, window.innerWidth - 210)),
                      bottom: window.innerHeight - card.top + 4
                    })
                    setMenu(open ? null : p.name)
                  }}
                >
                  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                    <circle cx="3.5" cy="8" r="1.3" fill="currentColor" />
                    <circle cx="8" cy="8" r="1.3" fill="currentColor" />
                    <circle cx="12.5" cy="8" r="1.3" fill="currentColor" />
                  </svg>
                </button>
              </div>
              {open && (
                <div className="poseshelf__menu" role="menu" style={menuAt}>
                  <button
                    type="button"
                    role="menuitem"
                    disabled={!canMirror}
                    title={canMirror ? undefined : 'Mirror needs left and right joints'}
                    onClick={() => run(() => onMirror(p.name))}
                  >
                    Mirror to a new pose
                  </button>
                  <button type="button" role="menuitem" onClick={() => run(() => onDuplicate(p.name))}>
                    Duplicate
                  </button>
                  <button type="button" role="menuitem" onClick={() => run(() => onUpdate(p.name))}>
                    Update from current
                  </button>
                  <button type="button" role="menuitem" onClick={() => run(() => onAddToTimeline(p.name))}>
                    Add to timeline at playhead
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="poseshelf__danger"
                    onClick={() =>
                      run(() => {
                        if (window.confirm(`Delete the pose “${p.name}”?`)) onDelete(p.name)
                      })
                    }
                  >
                    Delete
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>
      <button type="button" className="poseshelf__save" onClick={onSave} title="Save pose — keep what is on screen as a new pose (S)">
        Save pose <kbd>S</kbd>
      </button>
    </div>
  )
}

export default RobotPoseShelf
