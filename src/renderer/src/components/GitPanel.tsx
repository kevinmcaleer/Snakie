import { useCallback, useEffect, useState } from 'react'
import './GitPanel.css'
import { useWorkspace } from '../store/workspace'
import {
  pathsToStage,
  stageActionLabel,
  stageActionTitle,
  type GitStageScope
} from '../../../shared/git-stage'
import type {
  GitBranchList,
  GitDiff,
  GitFileStatus,
  GitPublishOptions,
  GitStatus
} from '../../../preload/index.d'
import { GitPublishDialog } from './GitPublishDialog'

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
 * (not an error) with an **Initialise Repository** button (#783), and every
 * async action surfaces failures inline rather than throwing. Git itself runs
 * in the main process, so this component is purely a thin view over the IPC
 * bridge.
 *
 * A repository with no remote gets **Publish to GitHub** (#795) where Push and
 * Pull would otherwise sit. That swap is the point: without a remote those two
 * buttons cannot do anything at all, so the toolbar was offering two dead
 * controls in exactly the state where one useful one belongs.
 *
 * This panel is desktop-only — `AppShell` never mounts it in the web build,
 * which has no filesystem and no local `git` to run.
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
  // Source control follows the app's shared working folder (chosen in Files /
  // the toolbar). Opening a folder here delegates to the same store action.
  const { currentFolder, openFolder: openWorkspaceFolder } = useWorkspace()
  const [repoPath, setRepoPath] = useState<string | null>(null)
  const [status, setStatus] = useState<GitStatus | null>(null)
  const [branches, setBranches] = useState<GitBranchList | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [openDiff, setOpenDiff] = useState<GitDiff | null>(null)
  const [loading, setLoading] = useState(false)
  const [publishOpen, setPublishOpen] = useState(false)

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

  // Follow the app's working folder: point the Git service at it and load
  // status whenever it changes. No separate repo picker — Git tracks Files.
  useEffect(() => {
    if (!currentFolder) {
      setRepoPath(null)
      setStatus(null)
      setBranches(null)
      return undefined
    }
    let cancelled = false
    void (async () => {
      setError(null)
      setNotice(null)
      setOpenDiff(null)
      try {
        await window.api.git.openRepo(currentFolder)
        if (cancelled) return
        setRepoPath(currentFolder)
        await refresh()
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [currentFolder, refresh])

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

  /**
   * Create a repository in the open folder (#783).
   *
   * Confirmed first, because this writes a `.git` folder to the user's disk and
   * is not something to discover by way of a stray click. The result is
   * reported verbatim — what was created, whether a `.gitignore` was written,
   * and how many files are now waiting — and any failure (no git installed, the
   * folder already inside a repo, an unwritable disk) is shown as words rather
   * than swallowed.
   */
  const initRepo = useCallback(async (): Promise<void> => {
    if (!repoPath) return
    const ok = window.confirm(
      `Create a Git repository in:\n\n${repoPath}\n\n` +
        'This adds a .git folder here, plus a starter .gitignore if the folder ' +
        "doesn't already have one. Nothing is committed — you choose what goes " +
        'into the first commit.'
    )
    if (!ok) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const result = await window.api.git.init()
      setNotice(result.warning ? `${result.summary} ${result.warning}` : result.summary)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [repoPath, refresh])

  /**
   * Stage a whole group at once (#794).
   *
   * No confirmation prompt, unlike #783's Initialise button: that one writes a
   * `.git` folder to the user's disk, whereas this only moves files into git's
   * index — reversible from the per-file unstage button right next to it. The
   * brake is the label instead, which carries the count, so "Stage 412
   * untracked" gives pause before the click rather than after it.
   *
   * The result is reported verbatim, and any failure (no git, an unreadable
   * working tree, a mid-batch abort) is shown as a sentence rather than
   * swallowed into a silently-unchanged panel.
   */
  const stageGroup = useCallback(
    async (scope: GitStageScope): Promise<void> => {
      setBusy(true)
      setError(null)
      setNotice(null)
      try {
        const result = await window.api.git.stageAll(scope)
        setNotice(result.summary)
        await refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setBusy(false)
      }
    },
    [refresh]
  )

  /**
   * Publish the open repository to GitHub (#795).
   *
   * No `window.confirm` in front of it, unlike #783's Initialise button: the
   * dialog itself IS the confirmation — it names the repository, names the
   * account it will land under, and makes public a deliberate second choice.
   * A second "are you sure?" on top of that would be the kind of prompt people
   * learn to dismiss without reading.
   *
   * The dialog stays open on failure so the name and description the user typed
   * survive to the next attempt; it closes only once the repository exists.
   */
  const publish = useCallback(
    async (options: GitPublishOptions): Promise<void> => {
      const result = await window.api.git.publish(options)
      setPublishOpen(false)
      setError(null)
      setNotice(result.warning ? `${result.summary} ${result.warning}` : result.summary)
      await refresh()
    },
    [refresh]
  )

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
          Open a folder (in the Files panel or below) to manage it with Git.
          Source control runs on your machine using the system <code>git</code>.
        </p>
        <button
          type="button"
          className="git__btn git__btn--primary"
          onClick={() => void openWorkspaceFolder()}
        >
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
        <p className="git__empty-note">
          Initialising one adds a <code>.git</code> folder here — and a starter{' '}
          <code>.gitignore</code> if this folder doesn&apos;t already have one. Nothing is
          committed: your files show up as <em>Untracked</em> so you can pick what goes into
          the first commit.
        </p>
        <div className="git__empty-actions">
          <button
            type="button"
            className="git__btn git__btn--primary"
            disabled={busy}
            title={`Run git init in ${repoPath}`}
            onClick={() => void initRepo()}
          >
            {busy ? 'Initialising…' : 'Initialise Repository'}
          </button>
          <button
            type="button"
            className="git__btn"
            disabled={busy}
            onClick={() => void openWorkspaceFolder()}
          >
            Open a different folder…
          </button>
          <button
            type="button"
            className="git__btn"
            disabled={busy}
            onClick={() => void refresh()}
          >
            Re-check
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
  // No remote at all is the state Publish exists for; anything configured means
  // the repo already lives somewhere and Push is the right button (#795).
  const hasRemote = (status?.remotes.length ?? 0) > 0

  // How many files each group's bulk-stage button would actually stage. Same
  // helper the main process uses to build the `git add` list (#794), so the
  // number on the button is the number that gets staged — including the fact
  // that conflicted files are held back, which is why this can differ from the
  // group's own count in the header.
  const groups = { changed, untracked }
  const conflictedCount = changed.filter((f) => f.kind === 'conflicted').length
  const stageableChanged = pathsToStage(groups, 'changed').length
  const stageableUntracked = pathsToStage(groups, 'untracked').length

  /** The bulk-stage button for a group header, or nothing when it would be a no-op. */
  const stageAllButton = (scope: GitStageScope, count: number): JSX.Element | null => {
    if (count <= 0) return null
    return (
      <button
        type="button"
        className="git__stage-all"
        disabled={busy}
        title={stageActionTitle(scope, count, scope === 'changed' ? conflictedCount : 0)}
        onClick={() => void stageGroup(scope)}
      >
        {stageActionLabel(scope, count)}
      </button>
    )
  }

  return (
    <div className="git">
      {/* Toolbar: branch indicator + repo actions */}
      <div className="git__toolbar">
        <span className="git__branch" title={status?.tracking ?? 'No upstream'}>
          <span className="git__branch-icon" aria-hidden="true">
            ⎇
          </span>
          {status?.branch ?? 'detached'}
          {/* A repo that has just been initialised has an unborn HEAD: the
              branch exists only as a name until the first commit creates it.
              Say so, rather than letting the toolbar imply a history. (#783) */}
          {status?.isRepo && !status.hasCommits && (
            <span
              className="git__unborn"
              title={`${status.branch ?? 'This branch'} doesn't exist yet — your first commit creates it.`}
            >
              no commits yet
            </span>
          )}
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
        {/* With no remote, Push and Pull have nowhere to go — offer the one
            button that fixes that instead of two that cannot work (#795). */}
        {hasRemote ? (
          <>
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
          </>
        ) : (
          <button
            type="button"
            className="git__publish-btn"
            title="Create a repository on GitHub from this folder and push to it"
            disabled={busy}
            onClick={() => setPublishOpen(true)}
          >
            Publish to GitHub
          </button>
        )}
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
            <div className="git__group-head">
              <span className="git__group-title">Staged Changes ({staged.length})</span>
            </div>
            <ul className="git__list">{staged.map((f) => fileRow(f, 'staged'))}</ul>
          </section>
        )}
        {changed.length > 0 && (
          <section className="git__group">
            {/* The bulk-stage button sits INSIDE the group it acts on, so its
                scope is never in doubt — a single panel-level "add changes"
                button next to both lists would read as "stage everything I can
                see", which is a different and much larger promise (#794). */}
            <div className="git__group-head">
              <span className="git__group-title">Changes ({changed.length})</span>
              {stageAllButton('changed', stageableChanged)}
            </div>
            <ul className="git__list">{changed.map((f) => fileRow(f, 'changed'))}</ul>
          </section>
        )}
        {untracked.length > 0 && (
          <section className="git__group">
            <div className="git__group-head">
              <span className="git__group-title">Untracked ({untracked.length})</span>
              {stageAllButton('untracked', stageableUntracked)}
            </div>
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

      {publishOpen && (
        <GitPublishDialog
          repoPath={status?.root ?? repoPath}
          onPublish={publish}
          onCancel={() => setPublishOpen(false)}
        />
      )}

      <div className="git__footer">
        <span className="git__repo-path" title={status?.root ?? repoPath}>
          {status?.root ?? repoPath}
        </span>
        <button type="button" className="git__link-btn" onClick={() => void openWorkspaceFolder()}>
          Change…
        </button>
      </div>
    </div>
  )
}
