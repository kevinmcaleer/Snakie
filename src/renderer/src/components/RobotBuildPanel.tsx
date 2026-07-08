import { useEffect, useRef, useState } from 'react'
import type { AssemblyItem, PrimitiveGeom } from './robot-assembly'
import type { PrimitiveKind } from './robot-build'
import { baseName } from './robot-mesh'
import { shouldAutoHide } from './pin-overlay'
import './RobotBuildPanel.css'

/**
 * ROBOT BUILD PANEL (#315a) — a floating, transparent, PINNABLE dock on the LEFT
 * of the pose tool (mirrors the breadboard's library dock). It holds the model
 * hierarchy (view-by-default; a pencil per row enters edit), buttons to add
 * box / cylinder / sphere blocks (each sticks to the selected part), the STL
 * import, and — while a primitive is being edited — a numeric size form. All the
 * 3-D interaction (select, push/pull faces) lives in RobotView.
 */
const STAR = (
  <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
    <path
      d="M8 1.6l1.9 3.9 4.3.6-3.1 3 .8 4.3L8 11.9 4.1 13.4l.8-4.3-3.1-3 4.3-.6z"
      fill="currentColor"
    />
  </svg>
)
const PENCIL = (
  <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
    <path d="M11.5 1.5l3 3L5 14l-3.5.5L2 11z" fill="none" stroke="currentColor" strokeWidth="1.4" />
  </svg>
)

export interface RobotBuildPanelProps {
  open: boolean
  pinned: boolean
  onSetOpen: (open: boolean) => void
  onSetPinned: (pinned: boolean) => void
  assembly: AssemblyItem[]
  selected: string | null
  onSelect: (link: string | null) => void
  editLink: string | null
  onEdit: (link: string | null) => void
  /** Geometry of the link being edited (for the size form), or null. */
  editGeom: PrimitiveGeom | null
  onAdd: (kind: PrimitiveKind) => void
  onSetSize: (link: string, dims: number[]) => void
  onDelete: (link: string) => void
  onImportStl: () => void
  canImport: boolean
  importing: boolean
  /** Editing needs a saved project file — disables add/edit with a hint. */
  canEdit: boolean
}

/** metres → integer mm (display) and back. */
const mm = (m: number): number => Math.round(m * 1000)
const toM = (millis: number): number => millis / 1000

function SizeForm({
  geom,
  onChange
}: {
  geom: PrimitiveGeom
  onChange: (dims: number[]) => void
}): JSX.Element {
  // Local mm state so typing doesn't rebuild the scene per keystroke; commit on
  // blur/Enter, clamped to a 1 mm minimum (a 0/blank field must never write a
  // degenerate size). Re-seeds when the geometry changes externally (a drag).
  const seed = geom.dims.map(mm)
  const [vals, setVals] = useState<number[]>(seed)
  const key = seed.join(',')
  useEffect(() => setVals(seed), [key]) // eslint-disable-line react-hooks/exhaustive-deps
  const commit = (): void => onChange(vals.map((v) => Math.max(0.001, toM(v > 0 ? v : 1))))
  const field = (label: string, i: number): JSX.Element => (
    <label className="robotbuild__mm" key={label}>
      <span>{label}</span>
      <input
        type="number"
        min={1}
        step={5}
        value={Number.isFinite(vals[i]) ? vals[i] : ''}
        onChange={(e) => {
          const n = [...vals]
          n[i] = Number(e.target.value)
          setVals(n)
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
        }}
      />
    </label>
  )
  return (
    <div className="robotbuild__size">
      {geom.kind === 'box' && (
        <>
          {field('L', 0)}
          {field('W', 1)}
          {field('H', 2)}
        </>
      )}
      {geom.kind === 'cylinder' && (
        <>
          {field('⌀r', 0)}
          {field('len', 1)}
        </>
      )}
      {geom.kind === 'sphere' && field('r', 0)}
      <span className="robotbuild__mm-unit">mm</span>
    </div>
  )
}

export function RobotBuildPanel(props: RobotBuildPanelProps): JSX.Element {
  const {
    open,
    pinned,
    onSetOpen,
    onSetPinned,
    assembly,
    selected,
    onSelect,
    editLink,
    onEdit,
    editGeom,
    onAdd,
    onSetSize,
    onDelete,
    onImportStl,
    canImport,
    importing,
    canEdit
  } = props
  const dockRef = useRef<HTMLElement | null>(null)

  if (!open) {
    return (
      <button
        type="button"
        className="robotbuild__tab"
        title="Build — add + edit blocks"
        onClick={() => {
          onSetOpen(true)
          requestAnimationFrame(() => dockRef.current?.focus())
        }}
      >
        Build
      </button>
    )
  }

  return (
    <aside
      className={`robotbuild__dock${pinned ? '' : ' robotbuild__dock--overlay'}`}
      ref={dockRef}
      tabIndex={-1}
      aria-label="Build panel"
      onBlur={(e) => {
        if (shouldAutoHide(pinned, dockRef.current, e.relatedTarget)) onSetOpen(false)
      }}
    >
      <div className="robotbuild__head">
        <button
          type="button"
          className={`robotbuild__pin${pinned ? ' is-pinned' : ''}`}
          onClick={() => onSetPinned(!pinned)}
          title={pinned ? 'Unpin — hide when it loses focus' : 'Pin the panel open'}
          aria-label={pinned ? 'Unpin the build panel' : 'Pin the build panel open'}
        >
          {STAR}
        </button>
        <span className="robotbuild__title">Build</span>
        <button
          type="button"
          className="robotbuild__collapse"
          onClick={() => onSetOpen(false)}
          title="Hide"
          aria-label="Hide the build panel"
        >
          ‹
        </button>
      </div>

      <div className="robotbuild__add" role="group" aria-label="Add a block">
        {(['box', 'cylinder', 'sphere'] as const).map((k) => (
          <button
            key={k}
            type="button"
            disabled={!canEdit}
            onClick={() => onAdd(k)}
            title={canEdit ? `Add a ${k}` : 'Save the robot to a project folder first'}
          >
            {k === 'box' ? '▦ Box' : k === 'cylinder' ? '⬭ Tube' : '● Ball'}
          </button>
        ))}
      </div>
      <p className="robotbuild__hint">
        {canEdit ? 'A new block sticks to the part you picked.' : 'Save this robot to a folder to build.'}
      </p>

      <ul className="robotbuild__parts">
        {assembly.map((it) => {
          const isSel = it.link === selected
          const isEdit = it.link === editLink
          return (
            <li
              className={`robotbuild__part${isSel ? ' is-sel' : ''}`}
              key={it.link}
            >
              <div className="robotbuild__part-row">
                <button
                  type="button"
                  className="robotbuild__part-name"
                  title={it.link}
                  onClick={() => onSelect(it.link)}
                >
                  <span className="robotbuild__part-label">{it.link}</span>
                  <span className={`robotbuild__part-geo${it.kind === 'mesh' ? ' is-mesh' : ''}`}>
                    {it.kind === 'mesh' ? baseName(it.mesh ?? '') : it.kind}
                  </span>
                </button>
                <button
                  type="button"
                  className={`robotbuild__edit${isEdit ? ' is-on' : ''}`}
                  onClick={() => onEdit(isEdit ? null : it.link)}
                  title={isEdit ? 'Done editing' : 'Edit this block'}
                  aria-label={`Edit ${it.link}`}
                >
                  {PENCIL}
                </button>
              </div>
              {isEdit && (
                <div className="robotbuild__editrow">
                  {editGeom ? (
                    <SizeForm geom={editGeom} onChange={(d) => onSetSize(it.link, d)} />
                  ) : (
                    <span className="robotbuild__editnote">Grab a face in 3D to resize, or…</span>
                  )}
                  <button
                    type="button"
                    className="robotbuild__del"
                    onClick={() => onDelete(it.link)}
                    title={`Delete ${it.link}`}
                  >
                    ✕
                  </button>
                </div>
              )}
            </li>
          )
        })}
        {assembly.length === 0 && <li className="robotbuild__empty">No blocks yet — add one above.</li>}
      </ul>

      <div className="robotbuild__foot">
        <button
          type="button"
          className="robotbuild__stl"
          disabled={!canImport || importing}
          onClick={onImportStl}
          title={canImport ? 'Import an STL / DAE mesh' : 'Save the robot to a project folder to import meshes'}
        >
          {importing ? 'Importing…' : '+ STL / DAE'}
        </button>
      </div>
    </aside>
  )
}

export default RobotBuildPanel
