import type { BuildTool, PrimitiveKind } from './robot-build'
import './RobotToolbar.css'

/**
 * ROBOT TOOLBAR (#335) — a small floating tool cluster (top-centre of the 3-D
 * stage): add a block, set the active builder tool, and undo/redo. Only the
 * active tool owns the canvas pointer (RobotView gates on it).
 */
export interface RobotToolbarProps {
  tool: BuildTool
  onSetTool: (t: BuildTool) => void
  /** Editing needs a saved project file — tools disable without one. */
  canEdit: boolean
  /** Add a primitive at the workspace origin. */
  onAdd: (kind: PrimitiveKind) => void
  /** Point-to-point measure tool (toggle). */
  measureActive: boolean
  onToggleMeasure: () => void
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
}

const MEASURE_ICON = (
  <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
    <rect x="1.5" y="5" width="13" height="6" rx="1" fill="none" stroke="currentColor" strokeWidth="1.3" />
    <path d="M4 5v2.5M6.5 5v3.5M9 5v2.5M11.5 5v3.5" fill="none" stroke="currentColor" strokeWidth="1.1" />
  </svg>
)

const ADD: Array<{ kind: PrimitiveKind; glyph: string; label: string }> = [
  { kind: 'box', glyph: '▦', label: 'Add a box' },
  { kind: 'cylinder', glyph: '⬭', label: 'Add a tube' },
  { kind: 'sphere', glyph: '●', label: 'Add a ball' }
]

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

const UNDO_ICON = (
  <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
    <path d="M6 4L2.5 7 6 10M2.8 7h6.7a3.5 3.5 0 0 1 0 7H7" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)
const REDO_ICON = (
  <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
    <path d="M10 4l3.5 3L10 10M13.2 7H6.5a3.5 3.5 0 0 0 0 7H9" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

export function RobotToolbar({
  tool,
  onSetTool,
  canEdit,
  onAdd,
  measureActive,
  onToggleMeasure,
  canUndo,
  canRedo,
  onUndo,
  onRedo
}: RobotToolbarProps): JSX.Element {
  return (
    <div className="robottool" role="toolbar" aria-label="Build tools">
      {ADD.map((a) => (
        <button
          key={a.kind}
          type="button"
          className="robottool__btn robottool__btn--add"
          disabled={!canEdit}
          title={canEdit ? a.label : 'Save the robot to a folder first'}
          aria-label={a.label}
          onClick={() => onAdd(a.kind)}
        >
          {a.glyph}
        </button>
      ))}
      <span className="robottool__sep" aria-hidden="true" />
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
      <button
        type="button"
        className={`robottool__btn${measureActive ? ' is-active' : ''}`}
        aria-pressed={measureActive}
        title="Measure distance (click two points)"
        aria-label="Measure distance"
        onClick={onToggleMeasure}
      >
        {MEASURE_ICON}
      </button>
      <span className="robottool__sep" aria-hidden="true" />
      <button
        type="button"
        className="robottool__btn"
        disabled={!canUndo}
        title="Undo (⌘Z)"
        aria-label="Undo"
        onClick={onUndo}
      >
        {UNDO_ICON}
      </button>
      <button
        type="button"
        className="robottool__btn"
        disabled={!canRedo}
        title="Redo (⇧⌘Z)"
        aria-label="Redo"
        onClick={onRedo}
      >
        {REDO_ICON}
      </button>
    </div>
  )
}

export default RobotToolbar
