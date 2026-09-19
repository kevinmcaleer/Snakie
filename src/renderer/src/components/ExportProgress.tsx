import { useEffect } from 'react'
import type { ExportPhase } from '../lib/pdf/project-pdf'
import './ExportProgress.css'

/**
 * The floating "exporting…" bar (#1114, epic #1105).
 *
 * Rasterising the blocks and the breadboard takes seconds on a big project,
 * and a disabled print icon says only "no" — it does not say "working". This
 * is the thing that says working: a small card above the status bar with the
 * phase it is on and how far through it is.
 *
 * It is deliberately NOT a modal. The export reads the workspace but does not
 * own it, so nothing here blocks the app; the bar floats over a corner and
 * takes itself away when the export settles, which is what "temporary" means.
 *
 * The moving sheen on the fill is the other half of the answer. The fractions
 * arrive in four hops and a single hop can be a long one, so a bar that only
 * grew would sit perfectly still through the slowest part of the job and read
 * as a hang — the misreading #842 was written about. The sheen is a transform
 * animation, so it keeps moving even on a frame the export is hogging.
 */

/** What each phase is called in front of the user. */
const PHASE_LABEL: Record<ExportPhase, string> = {
  blocks: 'Rendering the blocks',
  wiring: 'Drawing the wiring',
  'laying out': 'Laying out the pages',
  writing: 'Writing the PDF'
}

/** How long the finished bar stays on screen before it removes itself. */
export const EXPORT_PROGRESS_DISMISS_MS = 1000
/** A failure is left up longer — it is the one state worth reading. */
export const EXPORT_PROGRESS_ERROR_MS = 2200

/** Where an export is up to: still going, done, or dead. */
export type ExportProgressState = 'working' | 'done' | 'failed'

export interface ExportProgressProps {
  phase: ExportPhase
  /** 0–1, as reported by the builder. */
  fraction: number
  state: ExportProgressState
  /** Called once the bar has had its say, so the owner can unmount it. */
  onDismiss: () => void
}

/** The line of text over the bar. */
export function exportProgressLabel(
  phase: ExportPhase,
  fraction: number,
  state: ExportProgressState
): string {
  if (state === 'failed') return 'Export failed'
  if (state === 'done') return 'PDF exported'
  // The builder is finished at 1 but the export is not: the save dialog (or the
  // browser's download) is still to come, and "Writing the PDF" at 100% for all
  // of it is the wrong thing to be staring at.
  return fraction >= 1 ? 'Saving the PDF' : PHASE_LABEL[phase]
}

export function ExportProgress({
  phase,
  fraction,
  state,
  onDismiss
}: ExportProgressProps): JSX.Element {
  const working = state === 'working'
  // Done means done: a failure keeps the fill where it stopped, because a bar
  // that fills up on the way to "failed" is telling a small lie.
  const pct = Math.round(Math.min(Math.max(state === 'done' ? 1 : fraction, 0), 1) * 100)
  const label = exportProgressLabel(phase, fraction, state)

  useEffect(() => {
    if (working) return
    const t = setTimeout(
      onDismiss,
      state === 'failed' ? EXPORT_PROGRESS_ERROR_MS : EXPORT_PROGRESS_DISMISS_MS
    )
    return () => clearTimeout(t)
  }, [working, state, onDismiss])

  return (
    <div className={`export-progress export-progress--${state}`} role="status" aria-live="polite">
      <div className="export-progress__head">
        <span className="export-progress__label">{label}</span>
        <span className="export-progress__pct">{pct}%</span>
      </div>
      <div
        className="export-progress__track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label="PDF export progress"
      >
        <div className="export-progress__fill" style={{ width: `${pct}%` }}>
          {working && <span className="export-progress__sheen" aria-hidden="true" />}
        </div>
      </div>
    </div>
  )
}
