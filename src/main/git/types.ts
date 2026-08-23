/**
 * Shared types for the built-in Git (version control) layer (issue #15).
 *
 * These types are intentionally plain (no class instances, no Buffers) so they
 * serialize cleanly across the Electron IPC boundary and can be re-used by the
 * preload typings and the renderer's Source Control panel.
 */

/** Working-tree status of a single file, as classified for the UI. */
export interface GitFileStatus {
  /** Repo-relative path. */
  path: string
  /** Single-letter index/worktree code (git porcelain), best-effort. */
  index: string
  workingDir: string
  /** True when the file is untracked (not yet known to git). */
  isUntracked: boolean
  /** True when the change is staged (present in the index). */
  isStaged: boolean
  /** Human-friendly classification used to drive the icon/colour in the UI. */
  kind: 'modified' | 'added' | 'deleted' | 'renamed' | 'conflicted' | 'untracked' | 'unknown'
}

/**
 * A snapshot of the repository status, safe to send over IPC. When `isRepo`
 * is false the remaining fields are empty/zero and the renderer should render a
 * "not a git repository" state instead of the file lists.
 */
export interface GitStatus {
  /** Whether the opened folder resolved to a git repository. */
  isRepo: boolean
  /** Resolved repository root (the top-level working dir), when `isRepo`. */
  root?: string
  /** Current branch name, or a detached-HEAD marker. */
  branch?: string
  /** Upstream tracking branch, if any (e.g. `origin/main`). */
  tracking?: string
  /** Commits the local branch is ahead of its upstream. */
  ahead: number
  /** Commits the local branch is behind its upstream. */
  behind: number
  /** Files present in the index (staged changes). */
  staged: GitFileStatus[]
  /** Tracked files with unstaged working-tree changes. */
  changed: GitFileStatus[]
  /** Untracked files (not yet known to git). */
  untracked: GitFileStatus[]
  /**
   * Whether the repo has at least one commit. False for a freshly-initialised
   * repo (unborn HEAD), where `branch` names a branch that does not exist yet
   * and there is nothing to diff, push or discard against.
   */
  hasCommits: boolean
  /**
   * Names of the configured remotes (usually `['origin']`, often empty).
   *
   * This is what decides whether the panel offers **Publish to GitHub** (#795):
   * a repository with no remote at all has nowhere for Push to push, which is
   * exactly the state that button exists to resolve. Once anything is
   * configured, the repo already lives somewhere and publishing it again is not
   * what the user means.
   */
  remotes: string[]
  /** Set when the folder is a repo but status could not be read fully. */
  warning?: string
}

/**
 * What `git init` actually did, so the panel can say it in words rather than
 * silently changing the view (issue #783). Creating a repository writes to the
 * user's disk, so the report is part of the contract, not a nicety.
 */
export interface GitInitResult {
  /** The folder that now holds `.git`. */
  root: string
  /** Branch the new repo starts on — the user's `init.defaultBranch`. */
  branch?: string
  /**
   * True when this call created a `.gitignore`. False when the folder already
   * had one (never overwritten) or when writing it failed — see `warning`.
   */
  wroteGitignore: boolean
  /** Number of files git can now see as untracked, for the report. */
  untrackedCount: number
  /** Set when the repo was created but a follow-up step did not fully succeed. */
  warning?: string
  /** One-line human-readable report of what happened. */
  summary: string
}

/**
 * Which group of files a bulk stage covers (#794). Defined in `shared/` because
 * the renderer needs the same vocabulary to label the button it clicks with.
 */
export type { GitStageScope } from '../../shared/git-stage'

/**
 * What a bulk stage actually staged (#794).
 *
 * Staging many files at once is easy to regret, so the panel reports it rather
 * than silently redrawing: the count and the paths are the receipt. `staged`
 * can legitimately be 0 (nothing in that group was stageable) — that is a
 * result, not an error, and `summary` says so in words.
 */
export interface GitStageResult {
  /** The group that was staged. */
  scope: import('../../shared/git-stage').GitStageScope
  /** How many files were added to the index. */
  staged: number
  /** The repo-relative paths staged, in the order the panel lists them. */
  paths: string[]
  /** One-line human-readable report of what happened. */
  summary: string
}

/** Result of listing branches. */
export interface GitBranchList {
  /** Currently checked-out branch (undefined when detached). */
  current?: string
  /** All local branch names. */
  branches: string[]
}

/** Unified diff text for a file, plus the side it came from. */
export interface GitDiff {
  /** Repo-relative path. */
  path: string
  /** Unified diff text (may be empty when there is no diff). */
  diff: string
  /** Whether the diff reflects staged (index) changes vs the working tree. */
  staged: boolean
}

/** Result of a push/pull, surfacing a short human-readable summary. */
export interface GitRemoteResult {
  /** Short summary suitable for a toast/status line. */
  summary: string
}

/**
 * What Snakie learned BEFORE opening the publish dialog (#795).
 *
 * Gathered up front rather than discovered on submit. Publishing is a single
 * irreversible click, so every reason it might fail — no `gh`, not signed in,
 * nothing committed yet, already has a remote — should be visible while the
 * user is still deciding, not after they have typed a description and pressed
 * the button.
 */
export interface GitPublishPreflight {
  /** True when a `gh` binary answered `gh --version`. */
  ghInstalled: boolean
  /** The version string `gh` reported, for the "not installed" help text. */
  ghVersion?: string
  /** True when `gh auth status` reports a signed-in host. */
  authenticated: boolean
  /** The signed-in GitHub login, so the dialog can show where this will land. */
  account?: string
  /** A sanitised starting name, derived from the repository folder. */
  suggestedName: string
  /** False for a repo with an unborn HEAD — there would be nothing to push. */
  hasCommits: boolean
  /** The first configured remote, when the repo already has one. */
  existingRemote?: string
  /** Tracked paths that usually hold secrets, for the public-visibility warning. */
  riskyPaths: string[]
  /**
   * The reasons publishing cannot go ahead right now, as sentences. Empty means
   * the dialog can offer its Publish button.
   */
  blockers: string[]
}

/** What the publish dialog collected, ready for `gh repo create`. */
export interface GitPublishOptions {
  /** `NAME` or `OWNER/NAME`. */
  name: string
  /** Optional one-line description. */
  description?: string
  /** Who can see the new repository. */
  visibility: import('../../shared/git-publish').GitVisibility
}

/**
 * What a publish actually did (#795).
 *
 * Creating a repository on someone else's server, under a name and a visibility
 * the user chose, is exactly the kind of act that has to report itself in words
 * rather than by quietly redrawing a panel. The URL is included so the panel can
 * offer to open what was just created — the fastest way to confirm the
 * visibility is what was asked for.
 */
export interface GitPublishResult {
  /** `owner/name`, as GitHub created it. */
  fullName: string
  /** Browser URL of the new repository. */
  url: string
  /** Who can see it. */
  visibility: import('../../shared/git-publish').GitVisibility
  /** The branch that was pushed. */
  branch?: string
  /** The remote name now pointing at GitHub. */
  remote: string
  /** Set when the repo was created but a follow-up step did not fully succeed. */
  warning?: string
  /** One-line human-readable report of what happened. */
  summary: string
}
