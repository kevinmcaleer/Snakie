import type { JSX } from 'react'
import { Notice } from './Notice'
import type { RequiredModule } from './part-imports'

/**
 * "Your code is missing imports / libraries for the connected parts" (#166).
 *
 * Shown when the project's placed parts link MicroPython libraries that the active
 * file doesn't `import` and/or the connected board doesn't have installed. Offers a
 * one-click install of the missing board libraries (those with a known source URL).
 *
 * Rendered through the shared compact {@link Notice} (#621). The summary is a short
 * count — the module names and which part wants each one are prose, and prose is
 * what made this wrap to three lines above every workspace. It is also gated to the
 * **Code** workspace by {@link AppShell}, since it is a fact about the open file.
 *
 * Presentational — all state lives in {@link AppShell}.
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
  /** Install the missing board libraries — bundled driver files copy straight
   *  to the board; modules with a source URL install via mip. */
  onInstall: () => void
  onDismiss: () => void
}): JSX.Element {
  const installable = missingOnBoard.filter((m) => (m.drivers?.length ?? 0) > 0 || m.url)
  const list = (ms: RequiredModule[]): string => ms.map((m) => m.module).join(', ')

  // Short enough to survive the one-line clamp; the names go in the detail.
  const parts: string[] = []
  if (missingOnBoard.length > 0) {
    parts.push(`board is missing ${missingOnBoard.length} librar${missingOnBoard.length === 1 ? 'y' : 'ies'}`)
  }
  if (missingImports.length > 0) {
    parts.push(`this file is missing ${missingImports.length} import${missingImports.length === 1 ? '' : 's'}`)
  }
  const summary = error
    ? `Couldn’t install: ${error}`
    : parts.join(' · ').replace(/^./, (c) => c.toUpperCase())

  return (
    <Notice
      tone={error ? 'error' : 'info'}
      summary={summary}
      detail={
        <>
          {missingOnBoard.length > 0 && (
            <div>
              The connected board is missing {missingOnBoard.length === 1 ? 'a library' : 'libraries'} your parts
              need: <strong>{list(missingOnBoard)}</strong>.
            </div>
          )}
          {missingImports.length > 0 && (
            <div>
              This file doesn’t <code>import</code> <strong>{list(missingImports)}</strong> (needed by{' '}
              {missingImports.flatMap((m) => m.parts).join(', ')}).
            </div>
          )}
        </>
      }
      action={
        installable.length > 0
          ? {
              label: installing
                ? 'Installing…'
                : error
                  ? 'Retry'
                  : `Install ${installable.length === 1 ? installable[0].module : `${installable.length} libraries`}`,
              onClick: onInstall,
              disabled: installing
            }
          : undefined
      }
      onDismiss={onDismiss}
      dismissDisabled={installing}
    />
  )
}
