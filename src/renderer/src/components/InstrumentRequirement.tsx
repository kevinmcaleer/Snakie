import type { CSSProperties } from 'react'
import { dispatchOpenHelp } from './editorBridge'
import './InstrumentRequirement.css'

/**
 * INSTRUMENT REQUIREMENT — a shared in-instrument "here's how to use me" panel.
 * =============================================================================
 *
 * Every instrument can now be OPENED from the dock even when its precondition
 * isn't met yet (no PWM pin for the scope, no `SNK ENV` telemetry for the
 * barometer, …). Instead of showing a blank dial / dashes with no explanation,
 * the instrument renders THIS panel in its body: a short headline, a couple of
 * plain-language lines, an optional runnable code snippet, and a "Learn more"
 * link that opens the instrument's help article. The moment the precondition is
 * satisfied, the instrument swaps back to its live view.
 *
 * Consistent across instruments so the guidance reads the same everywhere.
 */

export interface InstrumentRequirementProps {
  /** Short headline, e.g. "No PWM signal yet". */
  title: string
  /** One or more plain explanation lines. */
  lines: string[]
  /** Optional example code shown in a mono block (the thing to add to run). */
  code?: string
  /** Optional help-article id → a "Learn more" link opens the Help Library. */
  helpId?: string
  /** Instrument accent colour, tints the icon + link. */
  accent?: string
}

export function InstrumentRequirement({
  title,
  lines,
  code,
  helpId,
  accent
}: InstrumentRequirementProps): JSX.Element {
  return (
    <div
      className="instr-req"
      role="note"
      style={accent ? ({ '--req-accent': accent } as CSSProperties) : undefined}
    >
      <svg className="instr-req__icon" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="9.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <circle cx="12" cy="7.6" r="1.15" fill="currentColor" />
        <rect x="11.1" y="10.4" width="1.8" height="7" rx="0.9" fill="currentColor" />
      </svg>
      <div className="instr-req__title">{title}</div>
      {lines.map((line, i) => (
        <p key={i} className="instr-req__line">
          {line}
        </p>
      ))}
      {code && (
        <pre className="instr-req__code">
          <code>{code}</code>
        </pre>
      )}
      {helpId && (
        <button type="button" className="instr-req__more" onClick={() => dispatchOpenHelp(helpId)}>
          Learn more →
        </button>
      )}
    </div>
  )
}
