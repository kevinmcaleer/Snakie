import { lazy, Suspense } from 'react'
import { MiniBoardView } from './MiniBoardView'
import { useWorkspaceLayout } from '../store/layout'
import { useLocalStorage } from '../hooks/useLocalStorage'
import './MiniViewer.css'

const RobotDockPanel = lazy(() => import('./RobotDockPanel').then((m) => ({ default: m.RobotDockPanel })))

/**
 * MINI VIEWER (#595, Soft Shell) — a peek card at the top of the instrument dock
 * in the Code / Electronics workspaces: a **Board / 3D** segmented toggle over
 * the app's REAL mini-board (`MiniBoardView`) and mini-3D (`RobotDockPanel`)
 * renders, plus an expand ⤢ that jumps to the matching full workspace
 * (Board → Electronics, 3D → Build). Only the card chrome is new; the inner
 * renders are the existing live components (handoff §"mini viewer fidelity").
 *
 * The Robot/Build workspace keeps `RobotDockPanel` directly (it IS the 3-D
 * cockpit there); this card is for the workspaces that otherwise show neither.
 */
export function MiniViewer({ source, isPython }: { source: string; isPython: boolean }): JSX.Element {
  const { switchWorkspace } = useWorkspaceLayout()
  const [mode, setMode] = useLocalStorage<'board' | '3d'>('snakie.miniViewer.mode', 'board')

  return (
    <div className={`miniviewer miniviewer--${mode}`}>
      <div className="miniviewer__head">
        <div className="miniviewer__seg" role="group" aria-label="Mini viewer">
          <button
            type="button"
            className={`miniviewer__seg-btn${mode === 'board' ? ' is-active' : ''}`}
            aria-pressed={mode === 'board'}
            onClick={() => setMode('board')}
          >
            Board
          </button>
          <button
            type="button"
            className={`miniviewer__seg-btn${mode === '3d' ? ' is-active' : ''}`}
            aria-pressed={mode === '3d'}
            onClick={() => setMode('3d')}
          >
            3D
          </button>
        </div>
        <button
          type="button"
          className="miniviewer__expand"
          title={mode === 'board' ? 'Open the Electronics workspace' : 'Open the Build workspace'}
          aria-label={mode === 'board' ? 'Expand to the Electronics workspace' : 'Expand to the Build workspace'}
          onClick={() => switchWorkspace(mode === 'board' ? 'board' : 'robot')}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <path
              d="M6 3H3v10h10v-3M9.5 2.5H13.5V6.5M13 3 8 8"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
      <div className="miniviewer__body">
        {mode === 'board' ? (
          <MiniBoardView source={source} isPython={isPython} />
        ) : (
          <Suspense fallback={<div className="miniviewer__loading">Loading 3D…</div>}>
            <RobotDockPanel embedded />
          </Suspense>
        )}
      </div>
    </div>
  )
}
