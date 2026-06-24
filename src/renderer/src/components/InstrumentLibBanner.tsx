import './InstrumentLibBanner.css'

/**
 * The manila "install the instrument library" banner (issue #108).
 *
 * A full-width notification pinned to the very top of the app (above the
 * toolbar) offering a one-click install of the MicroPython instrument library
 * (`instruments.py`, issue #107) onto the connected board — shown only when the
 * board doesn't already have it. Reuses the Packages panel's manila/kraft
 * material + gold-key action so it reads as part of the same skeuomorph kit.
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
  return (
    <div className="inst-lib-banner" role="status" aria-live="polite">
      <span className="inst-lib-banner__spine" aria-hidden="true" />
      <div className="inst-lib-banner__text">
        {error ? (
          <span className="inst-lib-banner__error">
            Couldn&rsquo;t {outdated ? 'update' : 'install'} the library: {error}
          </span>
        ) : outdated ? (
          <>
            A newer Snakie instrument library is available — update your board to get
            the latest instruments (buzzer, scanners, …) and fixes.
          </>
        ) : (
          <>
            The Snakie instrument library isn&rsquo;t on your board — install it to
            stream live scope/meter/plotter readings.
          </>
        )}
      </div>
      <button
        type="button"
        className="inst-lib-banner__key"
        onClick={onInstall}
        disabled={installing}
      >
        {installing
          ? outdated
            ? 'Updating…'
            : 'Installing…'
          : error
            ? 'Retry'
            : outdated
              ? 'Update library'
              : 'Download & install'}
      </button>
      <button
        type="button"
        className="inst-lib-banner__close"
        onClick={onDismiss}
        disabled={installing}
        aria-label="Dismiss"
        title="Dismiss"
      >
        ✕
      </button>
    </div>
  )
}
