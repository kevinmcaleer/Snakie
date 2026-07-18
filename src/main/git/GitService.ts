import { simpleGit, type SimpleGit, type StatusResult } from 'simple-git'
import type {
  GitBranchList,
  GitDiff,
  GitFileStatus,
  GitRemoteResult,
  GitStatus
} from './types'

/**
 * Thin wrapper around `simple-git`, scoped to a single chosen repository
 * directory (issue #15).
 *
 * The renderer picks a folder (via the existing `fs.openFolderDialog`) and
 * hands the path to {@link GitService.openRepo}. From then on every operation
 * runs in that directory. The class never throws for the common "this folder
 * is not a git repo" case — {@link GitService.status} returns `{ isRepo:false }`
 * so the panel can render a clear empty state. Genuine git errors (e.g. a
 * failed push) DO reject, and are surfaced through the IPC `IpcResult` wrapper.
 */
export class GitService {
  /** The repo directory currently targeted, or null when none is open. */
  private dir: string | null = null
  /** Lazily-created simple-git instance bound to {@link dir}. */
  private git: SimpleGit | null = null

  /**
   * Point the service at `path`. Does not assert that `path` is a repo — call
   * {@link status} afterwards, which reports `isRepo` cleanly. Returns the
   * resolved repository root when `path` is inside a repo, otherwise null.
   */
  async openRepo(path: string): Promise<string | null> {
    this.dir = path
    this.git = simpleGit({ baseDir: path })
    const root = await this.repoRoot()
    // Rebind to the repo ROOT (#506): `git status --porcelain` paths are
    // root-relative, so add/reset/checkout run from a subfolder resolved them
    // against the wrong directory — the Git panel broke whenever the opened
    // folder wasn't the repo root.
    if (root && root !== path) this.git = simpleGit({ baseDir: root })
    return root
  }

  /** The directory currently targeted (the user's chosen folder). */
  get currentDir(): string | null {
    return this.dir
  }

  /** Resolve the bound simple-git instance, throwing if no folder is open. */
  private require(): SimpleGit {
    if (!this.git) throw new Error('No folder is open. Pick a repository first.')
    return this.git
  }

  /**
   * Return the repository root for the open folder, or null when the folder is
   * not inside a git working tree. Never throws for the not-a-repo case.
   */
  private async repoRoot(): Promise<string | null> {
    const git = this.git
    if (!git) return null
    try {
      const isRepo = await git.checkIsRepo()
      if (!isRepo) return null
      const root = (await git.revparse(['--show-toplevel'])).trim()
      return root || this.dir
    } catch {
      return null
    }
  }

  /**
   * Classify a single file from a {@link StatusResult} into the UI buckets.
   * `index`/`workingDir` are the porcelain single-letter codes simple-git
   * surfaces per file.
   */
  private classify(
    path: string,
    index: string,
    workingDir: string,
    isUntracked: boolean,
    conflicted: boolean
  ): GitFileStatus {
    const codes = `${index}${workingDir}`
    let kind: GitFileStatus['kind'] = 'unknown'
    if (conflicted) kind = 'conflicted'
    else if (isUntracked) kind = 'untracked'
    else if (codes.includes('A')) kind = 'added'
    else if (codes.includes('D')) kind = 'deleted'
    else if (codes.includes('R')) kind = 'renamed'
    else if (codes.includes('M') || codes.includes('T')) kind = 'modified'

    const isStaged = index !== ' ' && index !== '?' && index !== '' && !isUntracked
    return { path, index, workingDir, isUntracked, isStaged, kind }
  }

  /**
   * Read the working-tree status. Returns `{ isRepo:false }` (not an error)
   * when the open folder is not a git repository, so the renderer can show a
   * clear empty state.
   */
  async status(): Promise<GitStatus> {
    const empty: GitStatus = {
      isRepo: false,
      ahead: 0,
      behind: 0,
      staged: [],
      changed: [],
      untracked: []
    }
    if (!this.git) return empty

    const root = await this.repoRoot()
    if (!root) return empty

    let s: StatusResult
    try {
      s = await this.require().status()
    } catch (err) {
      return {
        ...empty,
        isRepo: true,
        root,
        warning: err instanceof Error ? err.message : String(err)
      }
    }

    const conflictedSet = new Set(s.conflicted)
    const staged: GitFileStatus[] = []
    const changed: GitFileStatus[] = []
    const untracked: GitFileStatus[] = []

    for (const f of s.files) {
      const isUntracked = f.index === '?' && f.working_dir === '?'
      const conflicted = conflictedSet.has(f.path)
      const fileStatus = this.classify(
        f.path,
        f.index,
        f.working_dir,
        isUntracked,
        conflicted
      )
      if (conflicted) {
        // Conflicts surface in the changed list so the user can resolve them.
        changed.push(fileStatus)
      } else if (isUntracked) {
        untracked.push(fileStatus)
      } else {
        // A file can be both staged and have further working changes; show it
        // in both lists so each part is independently stage/unstage-able.
        if (fileStatus.index !== ' ' && fileStatus.index !== '') {
          staged.push({ ...fileStatus, isStaged: true })
        }
        if (fileStatus.workingDir !== ' ' && fileStatus.workingDir !== '') {
          changed.push({ ...fileStatus, isStaged: false })
        }
      }
    }

    return {
      isRepo: true,
      root,
      branch: s.current ?? undefined,
      tracking: s.tracking ?? undefined,
      ahead: s.ahead ?? 0,
      behind: s.behind ?? 0,
      staged,
      changed,
      untracked
    }
  }

  /** Stage a single file (git add). */
  async stage(file: string): Promise<void> {
    await this.require().add([file])
  }

  /** Unstage a single file (git reset HEAD -- file), tolerating no-HEAD repos. */
  async unstage(file: string): Promise<void> {
    const git = this.require()
    try {
      await git.reset(['HEAD', '--', file])
    } catch {
      // Fresh repo with no commits yet: unstage via `git rm --cached`.
      await git.raw(['rm', '--cached', '--', file])
    }
  }

  /**
   * Discard working-tree changes for `file`. For tracked files this is a
   * checkout from HEAD; for untracked files it removes them from disk.
   */
  async discard(file: string): Promise<void> {
    const git = this.require()
    const s = await git.status()
    const entry = s.files.find((f) => f.path === file)
    const isUntracked = entry?.index === '?' && entry?.working_dir === '?'
    if (isUntracked) {
      await git.clean('f', ['--', file])
    } else {
      await git.checkout(['--', file])
    }
  }

  /**
   * Commit with `message`. When `stageAll` is true (the default), any unstaged
   * tracked changes are staged first so the commit captures everything the user
   * sees; otherwise only what is already in the index is committed.
   */
  async commit(message: string, stageAll = true): Promise<void> {
    const trimmed = message.trim()
    if (!trimmed) throw new Error('Commit message must not be empty.')
    const git = this.require()
    if (stageAll) await git.add(['-A'])
    await git.commit(trimmed)
  }

  /**
   * Unified diff for `file`. When `staged` is true the diff is index-vs-HEAD;
   * otherwise it is working-tree-vs-index. Untracked files have no diff, so we
   * synthesize an "added" diff with `--no-index` against /dev/null.
   */
  async diff(file: string, staged = false): Promise<GitDiff> {
    const git = this.require()
    if (staged) {
      const text = await git.diff(['--cached', '--', file])
      return { path: file, diff: text, staged: true }
    }

    const s = await git.status()
    const entry = s.files.find((f) => f.path === file)
    const isUntracked = entry?.index === '?' && entry?.working_dir === '?'
    if (isUntracked) {
      try {
        // --no-index exits non-zero when files differ; capture its output.
        const text = await git.raw(['diff', '--no-index', '--', '/dev/null', file])
        return { path: file, diff: text, staged: false }
      } catch (err) {
        const out = err instanceof Error ? err.message : String(err)
        return { path: file, diff: out, staged: false }
      }
    }

    const text = await git.diff(['--', file])
    return { path: file, diff: text, staged: false }
  }

  /** Current branch name, or undefined when detached / no commits. */
  async currentBranch(): Promise<string | undefined> {
    const git = this.require()
    const branches = await git.branchLocal()
    return branches.current || undefined
  }

  /** List local branches plus the current one. */
  async listBranches(): Promise<GitBranchList> {
    const git = this.require()
    const branches = await git.branchLocal()
    return {
      current: branches.current || undefined,
      branches: branches.all
    }
  }

  /** Check out an existing branch. */
  async checkout(branch: string): Promise<void> {
    await this.require().checkout(branch)
  }

  /** Push the current branch to its upstream. */
  async push(): Promise<GitRemoteResult> {
    const git = this.require()
    const result = await git.push()
    const updates = result.update ? ` (${result.update.hash.from}..${result.update.hash.to})` : ''
    return { summary: `Pushed${updates}`.trim() }
  }

  /** Pull from the upstream of the current branch. */
  async pull(): Promise<GitRemoteResult> {
    const git = this.require()
    const result = await git.pull()
    const { changes, insertions, deletions } = result.summary
    return {
      summary: `Pulled: ${changes} file(s), +${insertions} -${deletions}`
    }
  }
}
