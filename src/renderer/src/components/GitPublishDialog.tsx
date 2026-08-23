import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './GitPublishDialog.css'
import { useFocusTrap } from '../hooks/useFocusTrap'
import {
  DEFAULT_VISIBILITY,
  secretWarning,
  splitOwnerAndName,
  validateRepoName,
  type GitVisibility
} from '../../../shared/git-publish'
import type { GitPublishOptions, GitPublishPreflight } from '../../../preload/index.d'

/**
 * PUBLISH TO GITHUB (issue #795)
 * ==============================
 *
 * The dialog behind the Source Control panel's **Publish to GitHub** button:
 * pick a name, a description and who can see it, and Snakie runs
 * `gh repo create --source … --push` in the main process.
 *
 * Three things shape this component, all of them because publishing is a
 * single click that cannot really be taken back:
 *
 *  1. **Every reason it could fail is shown BEFORE the form.** The preflight
 *     runs while the dialog opens, so "gh isn't installed" or "you have no
 *     commits yet" appears instead of the form — not after the user has typed a
 *     description and pressed a button.
 *  2. **Private is the default**, and public is a deliberate second click. See
 *     `DEFAULT_VISIBILITY` for why that is a safety decision and not a
 *     preference.
 *  3. **The name is validated as it is typed**, using the same helper the main
 *     process guards with, so the dialog can never accept something `gh` will
 *     reject.
 */

interface GitPublishDialogProps {
  /** Repository root being published, for the "what am I publishing" line. */
  repoPath: string
  /** Called with the collected options when the user confirms. */
  onPublish: (options: GitPublishOptions) => Promise<void>
  /** Close without publishing. */
  onCancel: () => void
}

export function GitPublishDialog({
  repoPath,
  onPublish,
  onCancel
}: GitPublishDialogProps): JSX.Element {
  const [preflight, setPreflight] = useState<GitPublishPreflight | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [visibility, setVisibility] = useState<GitVisibility>(DEFAULT_VISIBILITY)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const dialogRef = useFocusTrap<HTMLDivElement>(true)

  /** Ask the main process what it knows, and seed the name from the folder. */
  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    setLoadError(null)
    try {
      const result = await window.api.git.publishPreflight()
      setPreflight(result)
      // Only seed the name the first time: re-checking after a `gh auth login`
      // must not throw away a name the user has already typed.
      setName((current) => current || result.suggestedName)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // Focus the name field once the form is actually on screen (not while the
  // preflight is still running, and not when it came back with blockers).
  const ready = !loading && !loadError && preflight !== null && preflight.blockers.length === 0
  useEffect(() => {
    if (ready) {
      const input = nameRef.current
      input?.focus()
      input?.select()
    }
  }, [ready])

  const check = useMemo(() => validateRepoName(name), [name])
  const owner = useMemo(() => splitOwnerAndName(name).owner, [name])

  // The secrets warning is shown ONLY for a public repo: on a private one these
  // same files are not exposed to anyone, and warning anyway would be the kind
  // of noise that teaches people to ignore the box.
  const risk = useMemo(
    () => (visibility === 'public' ? secretWarning(preflight?.riskyPaths ?? []) : undefined),
    [visibility, preflight]
  )

  /** Where this will land, spelled out so the destination is never a surprise. */
  const destination = useMemo(() => {
    if (!check.ok) return null
    const account = owner ?? preflight?.account
    const { name: bare } = splitOwnerAndName(name)
    return account ? `${account}/${bare}` : bare
  }, [check.ok, owner, preflight, name])

  const submit = useCallback(async (): Promise<void> => {
    if (!check.ok || busy) return
    setBusy(true)
    setError(null)
    try {
      await onPublish({ name: name.trim(), description: description.trim(), visibility })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }, [check.ok, busy, name, description, visibility, onPublish])

  const folder = repoPath.split(/[\\/]/).filter(Boolean).pop() ?? repoPath

  return (
    <div
      className="gh-pub__overlay"
      onMouseDown={(e) => {
        // Backdrop click cancels — but never mid-publish, when the repository
        // may already exist on GitHub and closing would hide the outcome.
        if (e.target === e.currentTarget && !busy) onCancel()
      }}
    >
      <div
        className="gh-pub"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="gh-pub-title"
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !busy) {
            e.preventDefault()
            onCancel()
          }
        }}
      >
        <h2 className="gh-pub__title" id="gh-pub-title">
          Publish to GitHub
        </h2>

        {loading && <p className="gh-pub__note">Checking GitHub CLI…</p>}

        {loadError && (
          <>
            <p className="gh-pub__error" role="alert">
              {loadError}
            </p>
            <div className="gh-pub__actions">
              <button type="button" className="gh-pub__btn" onClick={onCancel}>
                Close
              </button>
              <button
                type="button"
                className="gh-pub__btn gh-pub__btn--primary"
                onClick={() => void load()}
              >
                Try again
              </button>
            </div>
          </>
        )}

        {/* Blocked: show WHY instead of a form that cannot be submitted. Each
            blocker is a sentence with the next action in it, so this state is
            a set of instructions rather than a dead end. */}
        {!loading && !loadError && preflight && preflight.blockers.length > 0 && (
          <>
            <p className="gh-pub__note">
              Snakie can&apos;t publish <code>{folder}</code> yet:
            </p>
            <ul className="gh-pub__blockers">
              {preflight.blockers.map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
            </ul>
            <div className="gh-pub__actions">
              <button type="button" className="gh-pub__btn" onClick={onCancel}>
                Close
              </button>
              <button
                type="button"
                className="gh-pub__btn gh-pub__btn--primary"
                onClick={() => void load()}
              >
                Re-check
              </button>
            </div>
          </>
        )}

        {ready && preflight && (
          <>
            <p className="gh-pub__note">
              Publishing <code>{folder}</code>
              {preflight.account && (
                <>
                  {' '}
                  as <strong>{preflight.account}</strong>
                </>
              )}
              . Snakie uses the GitHub CLI, so it never sees your GitHub password or token.
            </p>

            <label className="gh-pub__label" htmlFor="gh-pub-name">
              Repository name
            </label>
            <input
              id="gh-pub-name"
              ref={nameRef}
              className="gh-pub__input"
              type="text"
              value={name}
              disabled={busy}
              spellCheck={false}
              autoComplete="off"
              placeholder="my-robot"
              aria-invalid={!check.ok}
              aria-describedby="gh-pub-name-help"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && check.ok) {
                  e.preventDefault()
                  void submit()
                }
              }}
            />
            <p className="gh-pub__help" id="gh-pub-name-help">
              {check.ok ? (
                destination ? (
                  <>
                    Will be created as <code>{destination}</code>. Type{' '}
                    <code>owner/name</code> to publish under an organisation.
                  </>
                ) : (
                  <>
                    Type <code>owner/name</code> to publish under an organisation.
                  </>
                )
              ) : (
                <span className="gh-pub__invalid">{check.error}</span>
              )}
            </p>

            <label className="gh-pub__label" htmlFor="gh-pub-desc">
              Description <span className="gh-pub__optional">(optional)</span>
            </label>
            <input
              id="gh-pub-desc"
              className="gh-pub__input"
              type="text"
              value={description}
              disabled={busy}
              placeholder="A line-following robot in MicroPython"
              onChange={(e) => setDescription(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && check.ok) {
                  e.preventDefault()
                  void submit()
                }
              }}
            />

            <fieldset className="gh-pub__visibility" disabled={busy}>
              <legend className="gh-pub__label">Who can see it</legend>
              <label className="gh-pub__radio">
                <input
                  type="radio"
                  name="gh-pub-visibility"
                  value="private"
                  checked={visibility === 'private'}
                  onChange={() => setVisibility('private')}
                />
                <span>
                  <strong>Private</strong>
                  <span className="gh-pub__radio-note">
                    Only you (and anyone you invite) can see it. You can make it public later.
                  </span>
                </span>
              </label>
              <label className="gh-pub__radio">
                <input
                  type="radio"
                  name="gh-pub-visibility"
                  value="public"
                  checked={visibility === 'public'}
                  onChange={() => setVisibility('public')}
                />
                <span>
                  <strong>Public</strong>
                  <span className="gh-pub__radio-note">
                    Anyone on the internet can see this repository and its whole history.
                  </span>
                </span>
              </label>
            </fieldset>

            {/* Named files, not a count — "1 risky file" is not something
                anyone can act on. Deliberately does not block: a .pem may well
                be a public certificate, and this is the user's project. */}
            {risk && (
              <p className="gh-pub__warn" role="alert">
                {risk}
              </p>
            )}

            {error && (
              <p className="gh-pub__error" role="alert">
                {error}
              </p>
            )}

            <div className="gh-pub__actions">
              <button
                type="button"
                className="gh-pub__btn"
                disabled={busy}
                onClick={onCancel}
              >
                Cancel
              </button>
              <button
                type="button"
                className="gh-pub__btn gh-pub__btn--primary"
                disabled={busy || !check.ok}
                title={
                  check.ok
                    ? `Create ${destination ?? name} on GitHub and push this branch`
                    : check.error
                }
                onClick={() => void submit()}
              >
                {busy ? 'Publishing…' : `Publish ${visibility === 'public' ? 'public' : 'private'} repository`}
              </button>
            </div>

            {/* A first push uploads the whole history — on a project full of
                meshes that is genuinely slow, and silence would read as a hang. */}
            {busy && (
              <p className="gh-pub__note gh-pub__note--busy">
                Creating the repository and pushing your commits. A first push sends the whole
                history, so this can take a minute on a large project.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
