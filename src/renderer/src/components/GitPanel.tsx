import { useCallback, useEffect, useState } from 'react'
import './GitPanel.css'
import type {
  GitBranchList,
  GitDiff,
  GitFileStatus,
  GitStatus
} from '../../../preload/index.d'

/**
 * SOURCE CONTROL TAB (issue #15)
 * ==============================
 *
 * A VS Code-style Git panel. The user picks a folder (reusing the native
 * `fs.openFolderDialog`); the main process resolves whether it is a repo and
 * reports status through `window.api.git`. From there the panel shows the
 * branch indicator, ahead/behind counts, staged / changed / untracked file
 * lists with per-file stage / unstage / discard actions, a commit box + button,
 * push/pull, and an inline unified-diff view.
 *
 * Everything degrades gracefully: a non-repo folder shows a clear empty state
 * (not an error), and every async action surfaces failures inline rather than
 * throwing. Git itself runs in the main process, so this component is purely a
 * thin view over the IPC bridge.
 */

/** A short glyph + label for each file-status kind, for the row marker. */
const KIND_MARK: Record<GitFileStatus['kind'], { mark: string; title: string }> = {
  modified: { mark: 'M', title: 'Modified' },
  added: { mark: 'A', title: 'Added' },
  deleted: { mark: 'D', title: 'Deleted' },
  renamed: { mark: 'R', title: 'Renamed' },
  conflicted: { mark: '!', title: 'Conflicted' },
  untracked: { mark: 'U', title: 'Untracked' },
  unknown: { mark: '?', title: 'Changed' }
}

/** Render a single colorized unified diff, line by line. */
function DiffView({ diff }: { diff: string }): JSX.Element {
  if (!diff.trim()) {
    return <p className="git__empty-note">No differences to show.</p>
  }
  const lines = diff.split(/\r?\n/)
  return (
    <pre className="git__diff" aria-label="File diff">
      {lines.map((line, i) => {
        let cls = 'git__diff-line'
        if (line.startsWith('+') && !line.startsWith('+++')) cls += ' git__diff-line--add'
        else if (line.startsWith('-') && !line.startsWith('---')) cls += ' git__diff-line--del'
        else if (line.startsWith('@@')) cls += ' git__diff-line--hunk'
        else if (
          line.startsWith('diff ') ||
          line.startsWith('index ') ||
          line.startsWith('+++') ||
          line.startsWith('---')
        )
          cls += ' git__diff-line--meta'
        return (
          <div key={i} className={cls}>
            {line || ' '}
          </div>
        )
      })}
    </pre>
  )
}

export function GitPanel(): JSX.Element {
  const [repoPath, setRepoPath] = useState<string | null>(null)
  const [status, setStatus] = useState<GitStatus | null>(null)
  const [branches, setBranches] = useState<GitBranchList | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [openDiff, setOpenDiff] = useState<GitDiff | null>(null)
  const [loading, setLoading] = useState(false)

  /** Reload status (and branches) for the open repo. */
  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const st = await window.api.git.status()
      setStatus(st)
      if (st.isRepo) {
        try {
          setBranches(await window.api.git.listBranches())
        } catch {
          setBranches(null)
        }
      } else {
        setBranches(null)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  /** Pick a folder and open it as a repository. */
  const openFolder = useCallback(async (): Promise<void> => {
    setError(null)
    setNotice(null)
    setOpenDiff(null)
    try {
      const picked = await window.api.fs.openFolderDialog()
      if (!picked) return
      await window.api.git.openRepo(picked)
      setRepoPath(picked)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [refresh])

  // Re-resolve status when a repo path is set (also covers the openRepo above).
  useEffect(() => {
    if (repoPath) void refresh()
  }, [repoPath, refresh])

  /** Run an action with busy-state + error capture, then refresh status. */
  const run = useCallback(
    async (fn: () => Promise<void>, successNotice?: string): Promise<void> => {
      setBusy(true)
      setError(null)
      setNotice(null)
      try {
        await fn()
        if (successNotice) setNotice(successNotice)
        await refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setBusy(false)
      }
    },
    [refresh]
  )

  const showDiff = useCallback(async (file: string, staged: boolean): Promise<void> => {
    setError(null)
    try {
      const d = await window.api.git.diff(file, staged)
      setOpenDiff(d)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  const commit = useCallback(async (): Promise<void> => {
    const msg = message.trim()
    if (!msg) {
      setError('Enter a commit message first.')
      return
    }
    await run(async () => {
      await window.api.git.commit(msg, true)
      setMessage('')
    }, 'Committed.')
  }, [message, run])

  // --- Render: no folder picked -------------------------------------------
  if (!repoPath) {
    return (
      <div className="git git--empty">
        <p className="git__empty-note">
          Open a folder to manage it with Git. Source control runs on your
          machine using the system <code>git</code>.
        </p>
        <button type="button" className="git__btn git__btn--primary" onClick={() => void openFolder()}>
          Open Folder…
        </button>
      </div>
    )
  }

  // --- Render: folder picked but not a git repo ---------------------------
  if (status && !status.isRepo) {
    return (
      <div className="git git--empty">
        <p className="git__empty-note">
          <code>{repoPath}</code> is not a Git repository.
        </p>
        <div className="git__empty-actions">
          <button type="button" className="git__btn" onClick={() => void openFolder()}>
            Open a different folder…
          </button>
          <button type="button" className="git__btn" onClick={() => void refresh()}>
            Re-check
          </button>
        </div>
      </div>
    )
  }

  const fileRow = (f: GitFileStatus, group: 'staged' | 'changed' | 'untracked'): JSX.Element => {
    const meta = KIND_MARK[f.kind]
    const name = f.path.split('/').pop() ?? f.path
    const dir = f.path.slice(0, f.path.length - name.length)
    return (
      <li key={`${group}:${f.path}`} className="git__file">
        <button
          type="button"
          className="git__file-main"
          title={`${meta.title} — click to view diff`}
          onClick={() => void showDiff(f.path, group === 'staged')}
        >
          <span className={`git__mark git__mark--${f.kind}`} aria-hidden="true">
            {meta.mark}
          </span>
          <span className="git__file-name">{name}</span>
          {dir && <span className="git__file-dir">{dir}</span>}
        </button>
        <span className="git__file-actions">
          {group === 'staged' ? (
            <button
              type="button"
              className="git__icon-btn"
              title="Unstage"
              disabled={busy}
              onClick={() => void run(() => window.api.git.unstage(f.path))}
            >
              −
            </button>
          ) : (
            <>
              <button
                type="button"
                className="git__icon-btn"
                title="Discard changes"
                disabled={busy}
                onClick={() => void run(() => window.api.git.discard(f.path))}
              >
                ⨯
              </button>
              <button
                type="button"
                className="git__icon-btn"
                title="Stage"
                disabled={busy}
                onClick={() => void run(() => window.api.git.stage(f.path))}
              >
                ＋
              </button>
            </>
          )}
        </span>
      </li>
    )
  }

  const staged = status?.staged ?? []
  const changed = status?.changed ?? []
  const untracked = status?.untracked ?? []
  const hasChanges = staged.length + changed.length + untracked.length > 0

  return (
    <div className="git">
      {/* Toolbar: branch indicator + repo actions */}
      <div className="git__toolbar">
        <span className="git__branch" title={status?.tracking ?? 'No upstream'}>
          <span className="git__branch-icon" aria-hidden="true">
            ⎇
          </span>
          {status?.branch ?? 'detached'}
          {status && (status.ahead > 0 || status.behind > 0) && (
            <span className="git__sync-counts">
              {status.ahead > 0 && <span title="Ahead">↑{status.ahead}</span>}
              {status.behind > 0 && <span title="Behind">↓{status.behind}</span>}
            </span>
          )}
        </span>
        <span className="git__toolbar-spacer" />
        <button
          type="button"
          className="git__icon-btn"
          title="Refresh"
          disabled={loading || busy}
          onClick={() => void refresh()}
        >
          ⟳
        </button>
        <button
          type="button"
          className="git__icon-btn"
          title="Pull"
          disabled={busy}
          onClick={() => void run(async () => void (await window.api.git.pull()), 'Pulled.')}
        >
          ↓
        </button>
        <button
          type="button"
          className="git__icon-btn"
          title="Push"
          disabled={busy}
          onClick={() => void run(async () => void (await window.api.git.push()), 'Pushed.')}
        >
          ↑
        </button>
      </div>

      {/* Branch switcher */}
      {branches && branches.branches.length > 0 && (
        <div className="git__branches">
          <label className="git__branches-label" htmlFor="git-branch-select">
            Branch
          </label>
          <select
            id="git-branch-select"
            className="git__branch-select"
            value={branches.current ?? ''}
            disabled={busy}
            onChange={(e) => {
              const next = e.target.value
              if (next && next !== branches.current) {
                void run(() => window.api.git.checkout(next), `Switched to ${next}`)
              }
            }}
          >
            {!branches.current && <option value="">(detached)</option>}
            {branches.branches.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Commit box */}
      <div className="git__commit">
        <textarea
          className="git__commit-msg"
          placeholder="Message (Ctrl+Enter to commit)"
          value={message}
          rows={2}
          disabled={busy}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
              e.preventDefault()
              void commit()
            }
          }}
        />
        <button
          type="button"
          className="git__btn git__btn--primary"
          disabled={busy || !message.trim()}
          title="Stage all changes and commit"
          onClick={() => void commit()}
        >
          Commit
        </button>
      </div>

      {error && (
        <p className="git__error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="git__notice" role="status">
          {notice}
        </p>
      )}

      {/* File lists */}
      <div className="git__lists">
        {staged.length > 0 && (
          <section className="git__group">
            <div className="git__group-head">Staged Changes ({staged.length})</div>
            <ul className="git__list">{staged.map((f) => fileRow(f, 'staged'))}</ul>
          </section>
        )}
        {changed.length > 0 && (
          <section className="git__group">
            <div className="git__group-head">Changes ({changed.length})</div>
            <ul className="git__list">{changed.map((f) => fileRow(f, 'changed'))}</ul>
          </section>
        )}
        {untracked.length > 0 && (
          <section className="git__group">
            <div className="git__group-head">Untracked ({untracked.length})</div>
            <ul className="git__list">{untracked.map((f) => fileRow(f, 'untracked'))}</ul>
          </section>
        )}
        {!hasChanges && !loading && (
          <p className="git__empty-note">No changes. Working tree is clean.</p>
        )}
      </div>

      {/* Diff viewer */}
      {openDiff && (
        <section className="git__diff-wrap">
          <div className="git__diff-head">
            <span className="git__diff-title">
              {openDiff.path}
              {openDiff.staged ? ' (staged)' : ''}
            </span>
            <button
              type="button"
              className="git__icon-btn"
              title="Close diff"
              onClick={() => setOpenDiff(null)}
            >
              ✕
            </button>
          </div>
          <DiffView diff={openDiff.diff} />
        </section>
      )}

      <div className="git__footer">
        <span className="git__repo-path" title={status?.root ?? repoPath}>
          {status?.root ?? repoPath}
        </span>
        <button type="button" className="git__link-btn" onClick={() => void openFolder()}>
          Change…
        </button>
      </div>
    </div>
  )
}
