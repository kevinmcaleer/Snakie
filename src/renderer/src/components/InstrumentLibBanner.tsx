import type { JSX } from 'react'
import { Notice } from './Notice'

/**
 * The "install the instrument library" notification (issue #108).
 *
 * Offers a one-click install of the MicroPython instrument library
 * (`instruments.py`, issue #107) onto the connected board — shown only when the
 * board doesn't already have it.
 *
 * Rendered through the shared compact {@link Notice} (#621): a one-line summary
 * with the action on it, and the "why you want this" prose behind the caret. It
 * used to be a free-flowing strip of text, which is fine alone and wasteful the
 * moment a second notice appears beside it.
 *
 * This is a PRESENTATIONAL component: all the show/hide/install state lives in
 * {@link AppShell}, which renders this only when the banner should be visible
 * (see `shouldShowBanner`) and drives `installing` / `error` / the callbacks.
 */
export function InstrumentLibBanner({
  installing,
  error,
  outdated = false,
  onInstall,
  onDismiss
}: {
  /** True while the library is being written to the board (disables the key). */
  installing: boolean
  /** A short error message to show if the last install attempt failed. */
  error?: string | null
  /**
   * The library is on the board but an OLDER version than Snakie bundles — show
   * "update" copy rather than "install" (the action overwrites either way).
   */
  outdated?: boolean
  /** Install / update the library onto the board (writes `/lib/instruments.py`). */
  onInstall: () => void
  /** Dismiss the banner for this open-session (re-shows on reopen). */
  onDismiss: () => void
}): JSX.Element {
  const verb = outdated ? 'update' : 'install'
  const summary = error
    ? `Couldn’t ${verb} the instrument library: ${error}`
    : outdated
      ? 'A newer Snakie instrument library is available'
      : 'The Snakie instrument library isn’t on your board'

  return (
    <Notice
      tone={error ? 'error' : 'info'}
      summary={summary}
      detail={
        outdated
          ? 'Update your board to get the latest instruments (buzzer, scanners, …) and fixes.'
          : 'Install it to stream live scope / meter / plotter readings from your program.'
      }
      action={{
        label: installing
          ? outdated
            ? 'Updating…'
            : 'Installing…'
          : error
            ? 'Retry'
            : outdated
              ? 'Update library'
              : 'Download & install',
        onClick: onInstall,
        disabled: installing
      }}
      onDismiss={onDismiss}
      dismissDisabled={installing}
    />
  )
}
