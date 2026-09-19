import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  EXPORT_PROGRESS_DISMISS_MS,
  EXPORT_PROGRESS_ERROR_MS,
  ExportProgress,
  exportProgressLabel
} from '../src/renderer/src/components/ExportProgress'

/**
 * The floating export bar (#1114, epic #1105).
 *
 * A disabled print icon says "no", not "working". This covers the thing that
 * says working: what it reads at each stage, that it is a real progressbar,
 * and that the toolbar drives it off the builder's own progress events rather
 * than a timer guessing at them.
 */

const TOOLBAR = readFileSync('src/renderer/src/components/Toolbar.tsx', 'utf-8')
const CSS = readFileSync('src/renderer/src/components/ExportProgress.css', 'utf-8')

const html = (over: Partial<Parameters<typeof ExportProgress>[0]> = {}): string =>
  renderToStaticMarkup(
    <ExportProgress phase="wiring" fraction={0.4} state="working" onDismiss={() => {}} {...over} />
  )

describe('what the bar says', () => {
  it('names the phase it is actually on', () => {
    expect(exportProgressLabel('blocks', 0.05, 'working')).toBe('Rendering the blocks')
    expect(exportProgressLabel('wiring', 0.4, 'working')).toBe('Drawing the wiring')
    expect(exportProgressLabel('laying out', 0.7, 'working')).toBe('Laying out the pages')
    expect(exportProgressLabel('writing', 0.9, 'working')).toBe('Writing the PDF')
  })

  it('stops claiming to be writing once the bytes are written', () => {
    // The builder finishes at 1; the save dialog is still to come, and sitting
    // on "Writing the PDF — 100%" through all of it is the wrong readout.
    expect(exportProgressLabel('writing', 1, 'working')).toBe('Saving the PDF')
  })

  it('reports the outcome, and does not fill up on the way to a failure', () => {
    expect(exportProgressLabel('wiring', 0.4, 'done')).toBe('PDF exported')
    expect(exportProgressLabel('wiring', 0.4, 'failed')).toBe('Export failed')
    expect(html({ state: 'failed' })).toContain('aria-valuenow="40"')
    expect(html({ state: 'done' })).toContain('aria-valuenow="100"')
  })
})

describe('the bar itself', () => {
  it('is a real progressbar with real ARIA values', () => {
    const markup = html({ fraction: 0.7 })
    expect(markup).toContain('role="progressbar"')
    expect(markup).toContain('aria-valuenow="70"')
    expect(markup).toContain('aria-valuemax="100"')
    expect(markup).toContain('width:70%')
  })

  it('announces itself politely rather than stealing focus', () => {
    // It floats over the app; it must not behave like a dialog.
    const markup = html()
    expect(markup).toContain('role="status"')
    expect(markup).toContain('aria-live="polite"')
    expect(markup).not.toContain('aria-modal')
  })

  it('keeps moving while it is working, and stops when it is not', () => {
    // A bar that only grew would sit still through the slowest phase and read
    // as a hang; a bar still shimmering after "done" would read as stuck.
    expect(html({ state: 'working' })).toContain('export-progress__sheen')
    expect(html({ state: 'done' })).not.toContain('export-progress__sheen')
  })

  it('clamps a fraction that came in out of range', () => {
    expect(html({ fraction: 1.4 })).toContain('aria-valuenow="100"')
    expect(html({ fraction: -1 })).toContain('aria-valuenow="0"')
  })

  it('takes itself away, leaving a failure up longest', () => {
    expect(EXPORT_PROGRESS_DISMISS_MS).toBeGreaterThan(0)
    expect(EXPORT_PROGRESS_ERROR_MS).toBeGreaterThan(EXPORT_PROGRESS_DISMISS_MS)
  })
})

describe('how the toolbar drives it', () => {
  it('shows the bar the moment the export starts', () => {
    expect(TOOLBAR).toContain(
      "setExportProgress({ phase: 'blocks', fraction: 0, state: 'working' })"
    )
  })

  it('follows the builder’s own progress events, not a timer', () => {
    expect(TOOLBAR).toContain('onProgress: ({ phase, fraction }) =>')
    expect(TOOLBAR).toContain("setExportProgress({ phase, fraction, state: 'working' })")
  })

  it('reports both endings', () => {
    expect(TOOLBAR).toContain("{ ...prev, state: 'done' }")
    expect(TOOLBAR).toContain("{ ...prev, state: 'failed' }")
    // A cancelled save dialog needs no badge — the user closed it themselves.
    expect(TOOLBAR).toContain("result.outcome === 'cancelled' || !prev ? null")
  })
})

describe('where it floats', () => {
  it('sits clear of the status bar, over the shell, out of the way of clicks', () => {
    expect(CSS).toContain('position: fixed')
    expect(CSS).toContain('pointer-events: none')
  })

  it('is themed with tokens, so it reads in both skins', () => {
    expect(CSS).toContain('var(--card')
    expect(CSS).toContain('var(--grad-run')
  })

  it('respects prefers-reduced-motion', () => {
    expect(CSS).toContain('@media (prefers-reduced-motion: reduce)')
  })
})
