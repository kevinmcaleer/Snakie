import type { JSX } from 'react'
import './RobotNextStep.css'

/**
 * NEXT STEP — what to do when a feature can't run yet.
 *
 * Snakie does not grey a feature out and leave the reason to a tooltip (which a
 * phone never shows). The control stays live; pressing it before its
 * precondition is met opens this card, which says in plain words what is
 * missing and offers the step that fixes it.
 */
export interface NextStepAction {
  label: string
  onPress: () => void
  /** The recommended step (filled green). */
  primary?: boolean
}

export interface NextStep {
  title: string
  body: string
  actions?: NextStepAction[]
}

export interface RobotNextStepProps {
  step: NextStep
  onClose: () => void
}

export function RobotNextStep({ step, onClose }: RobotNextStepProps): JSX.Element {
  return (
    <div className="nextstep" role="dialog" aria-label={step.title}>
      <div className="nextstep__head">
        <strong className="nextstep__title">{step.title}</strong>
        <button type="button" className="nextstep__close" onClick={onClose} aria-label="Close" title="Close">
          ✕
        </button>
      </div>
      <p className="nextstep__body">{step.body}</p>
      {step.actions && step.actions.length > 0 && (
        <div className="nextstep__actions">
          {step.actions.map((a) => (
            <button
              key={a.label}
              type="button"
              className={`nextstep__btn${a.primary ? ' nextstep__btn--primary' : ''}`}
              onClick={a.onPress}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default RobotNextStep
