import { useRef, useState } from 'react'
import type { JointDef, JointSpec, PrimitiveGeom } from './robot-assembly'
import { SizeForm, JointForm } from './RobotBuildPanel'
import './RobotPropertiesDialog.css'

/**
 * PROPERTIES DIALOG (#352, Fusion-style) — a floating, draggable dialog on the
 * RIGHT that holds the properties of the block being edited (its size + joint).
 * Edits apply live (so the 3-D preview updates); the footer commits (**OK**) or
 * reverts (**Cancel**) — RobotView snapshots the URDF when it opens and restores
 * it on Cancel. Both close edit mode.
 */
export interface RobotPropertiesDialogProps {
  /** The link being edited (title). */
  link: string
  geom: PrimitiveGeom | null
  joint: JointDef | null
  jointNames: string[]
  onSetSize: (link: string, dims: number[]) => void
  onSetJoint: (link: string, spec: JointSpec) => void
  onOk: () => void
  onCancel: () => void
}

export function RobotPropertiesDialog({
  link,
  geom,
  joint,
  jointNames,
  onSetSize,
  onSetJoint,
  onOk,
  onCancel
}: RobotPropertiesDialogProps): JSX.Element {
  // Drag the dialog by its title bar. `pos` null = the default docked spot (CSS).
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const drag = useRef<{ dx: number; dy: number } | null>(null)
  const onHeadDown = (e: React.PointerEvent): void => {
    const rect = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect()
    drag.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top }
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
  }
  const onHeadMove = (e: React.PointerEvent): void => {
    if (!drag.current) return
    setPos({ x: e.clientX - drag.current.dx, y: e.clientY - drag.current.dy })
  }
  const onHeadUp = (e: React.PointerEvent): void => {
    drag.current = null
    ;(e.target as HTMLElement).releasePointerCapture?.(e.pointerId)
  }

  const style = pos ? { left: `${pos.x}px`, top: `${pos.y}px`, right: 'auto' } : undefined

  return (
    <aside className="robotprops" style={style} role="dialog" aria-label={`Properties — ${link}`}>
      <div
        className="robotprops__head"
        onPointerDown={onHeadDown}
        onPointerMove={onHeadMove}
        onPointerUp={onHeadUp}
      >
        <span className="robotprops__grip" aria-hidden="true">
          ⠿
        </span>
        <span className="robotprops__title" title={link}>
          {link}
        </span>
      </div>
      <div className="robotprops__body">
        {geom ? (
          <section className="robotprops__section">
            <div className="robotprops__label">Size (mm)</div>
            <SizeForm geom={geom} onChange={(d) => onSetSize(link, d)} />
          </section>
        ) : (
          <p className="robotprops__note">This is a mesh — grab a face in 3-D to move it.</p>
        )}
        {joint ? (
          <section className="robotprops__section">
            <div className="robotprops__label">Joint</div>
            <JointForm joint={joint} names={jointNames} onChange={(spec) => onSetJoint(link, spec)} />
          </section>
        ) : (
          <p className="robotprops__note">This is the base — nothing to join to.</p>
        )}
      </div>
      <div className="robotprops__foot">
        <button type="button" className="robotprops__btn" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="robotprops__btn robotprops__btn--ok" onClick={onOk}>
          OK
        </button>
      </div>
    </aside>
  )
}

export default RobotPropertiesDialog
