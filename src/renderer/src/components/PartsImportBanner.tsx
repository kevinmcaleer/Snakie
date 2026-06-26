import './InstrumentLibBanner.css'
import type { RequiredModule } from './part-imports'

/**
 * "Your code is missing imports / libraries for the connected parts" banner (#166).
 *
 * Shown at the top of the app when the project's placed parts link MicroPython
 * libraries that the active file doesn't `import` and/or the connected board
 * doesn't have installed. Offers a one-click install of the missing board
 * libraries (those with a known source URL). Presentational — all state lives in
 * {@link AppShell}. Reuses the instrument-library banner's manila styling.
 */
export function PartsImportBanner({
  missingImports,
  missingOnBoard,
  installing,
  error,
  onInstall,
  onDismiss
}: {
  /** Required modules the active file doesn't import. */
  missingImports: RequiredModule[]
  /** Required modules not importable on the connected board. */
  missingOnBoard: RequiredModule[]
  installing: boolean
  error?: string | null
  /** Install the missing board libraries (those with a source URL). */
  onInstall: () => void
  onDismiss: () => void
}): JSX.Element {
  const installable = missingOnBoard.filter((m) => m.url)
  const list = (ms: RequiredModule[]): string => ms.map((m) => m.module).join(', ')
  return (
    <div className="inst-lib-banner" role="status" aria-live="polite">
      <span className="inst-lib-banner__spine" aria-hidden="true" />
      <div className="inst-lib-banner__text">
        {error ? (
          <span className="inst-lib-banner__error">Couldn&rsquo;t install: {error}</span>
        ) : (
          <>
            {missingOnBoard.length > 0 && (
              <>
                The connected board is missing {missingOnBoard.length === 1 ? 'a library' : 'libraries'} your parts
                need: <strong>{list(missingOnBoard)}</strong>.{' '}
              </>
            )}
            {missingImports.length > 0 && (
              <>
                This file doesn&rsquo;t <code>import</code> <strong>{list(missingImports)}</strong> (needed by{' '}
                {missingImports.flatMap((m) => m.parts).join(', ')}).
              </>
            )}
          </>
        )}
      </div>
      {installable.length > 0 && (
        <button type="button" className="inst-lib-banner__key" onClick={onInstall} disabled={installing}>
          {installing ? 'Installing…' : error ? 'Retry' : `Install ${installable.length === 1 ? installable[0].module : `${installable.length} libraries`}`}
        </button>
      )}
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
