import { ReactNode } from 'react'

interface PlaceholderProps {
  /** Region label shown to the developer until real content lands. */
  label: string
  /** Short hint describing what will eventually live here. */
  hint?: string
  children?: ReactNode
}

/**
 * Neutral region placeholder. Later agents replace the body of each region
 * component (FilePanel, EditorArea, ShellPanel, RightPanel) with real content;
 * this keeps the empty seams visually obvious in the meantime.
 */
export function Placeholder({ label, hint, children }: PlaceholderProps): JSX.Element {
  return (
    <div className="placeholder">
      <span className="placeholder__label">{label}</span>
      {hint && <span className="placeholder__hint">{hint}</span>}
      {children}
    </div>
  )
}
