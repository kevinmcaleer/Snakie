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
  /** Set when the folder is a repo but status could not be read fully. */
  warning?: string
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
