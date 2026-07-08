import type { BuildTool } from './robot-build'
import './RobotToolbar.css'

/**
 * ROBOT TOOLBAR (#335) — a small floating tool cluster (top-centre of the 3-D
 * stage) that sets the active builder tool. Only the active tool owns the canvas
 * pointer (RobotView gates on it). Kid-friendly labels, no jargon.
 */
export interface RobotToolbarProps {
  tool: BuildTool
  onSetTool: (t: BuildTool) => void
  /** Editing needs a saved project file — tools disable without one. */
  canEdit: boolean
}

const ICONS: Record<BuildTool, JSX.Element> = {
  select: (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <path d="M3 2l9 4.5-3.8 1 1.9 4.2-1.6.7-1.9-4.2L3 11z" fill="currentColor" />
    </svg>
  ),
  pushpull: (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <rect x="2" y="4" width="7" height="8" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M10 8h4M12 6l2 2-2 2" fill="none" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  ),
  move: (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <path
        d="M8 1v14M1 8h14M8 1L6 3M8 1l2 2M8 15l-2-2M8 15l2-2M1 8l2-2M1 8l2 2M15 8l-2-2M15 8l-2 2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
      />
    </svg>
  ),
  joint: (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <circle cx="4" cy="8" r="2.2" fill="currentColor" />
      <circle cx="12" cy="8" r="2.2" fill="currentColor" />
      <path d="M6 8h4" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  )
}

const TOOLS: Array<{ id: BuildTool; label: string; soon?: boolean }> = [
  { id: 'select', label: 'Pick a block' },
  { id: 'pushpull', label: 'Push & pull to resize' },
  { id: 'move', label: 'Move a block' },
  { id: 'joint', label: 'Join two blocks (coming soon)', soon: true }
]

export function RobotToolbar({ tool, onSetTool, canEdit }: RobotToolbarProps): JSX.Element {
  return (
    <div className="robottool" role="toolbar" aria-label="Build tools">
      {TOOLS.map((t) => {
        const disabled = t.soon || !canEdit
        return (
          <button
            key={t.id}
            type="button"
            className={`robottool__btn${tool === t.id ? ' is-active' : ''}`}
            aria-pressed={tool === t.id}
            disabled={disabled}
            title={!canEdit && !t.soon ? 'Save the robot to a folder first' : t.label}
            aria-label={t.label}
            onClick={() => onSetTool(t.id)}
          >
            {ICONS[t.id]}
          </button>
        )
      })}
    </div>
  )
}

export default RobotToolbar
