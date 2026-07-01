import { ReactNode } from 'react'

interface PanelHeaderProps {
  /** The panel title. Pass an empty string to hide it (e.g. the Shell header,
   *  which is all actions) — the actions then fill the row, right-aligned. */
  title: string
  /** Optional action slot (buttons, toggles) rendered right-aligned. */
  actions?: ReactNode
}

/**
 * Consistent header bar for each region. Gives later agents a predictable
 * place to drop per-panel toolbars/actions.
 */
export function PanelHeader({ title, actions }: PanelHeaderProps): JSX.Element {
  return (
    <header className="panel-header">
      {title && <span className="panel-header__title">{title}</span>}
      {actions && <div className="panel-header__actions">{actions}</div>}
    </header>
  )
}
