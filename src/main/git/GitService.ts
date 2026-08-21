import { constants as fsConstants } from 'fs'
import { access, realpath, writeFile } from 'fs/promises'
import { join } from 'path'
import { simpleGit, type SimpleGit, type StatusResult } from 'simple-git'
import { SNAKIE_GITIGNORE, gitFailureText, initSummary } from './init-support'
import type {
  GitBranchList,
  GitDiff,
  GitFileStatus,
  GitInitResult,
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
   * Whether the repo has at least one commit. A freshly-initialised repo has an
   * unborn HEAD: `git status` still names a branch, but `rev-parse HEAD` fails
   * and there is nothing to diff or push against.
   */
  private async hasCommits(): Promise<boolean> {
    const git = this.git
    if (!git) return false
    try {
      // `--quiet` so an unborn HEAD exits 1 silently instead of printing
      // "fatal: Needed a single revision" into Snakie's console on every
      // status refresh of a brand-new repo. That quiet exit is NOT an
      // exception as far as simple-git is concerned — it just yields empty
      // output — so the resolved value decides, not the absence of a throw.
      const head = (await git.revparse(['--verify', '--quiet', 'HEAD'])).trim()
      return head.length > 0
    } catch {
      return false
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
      untracked: [],
      hasCommits: false
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
        warning: gitFailureText(err)
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
      untracked,
      hasCommits: await this.hasCommits()
    }
  }

  /**
   * Create a Git repository in the open folder (issue #783).
   *
   * Deliberately does THREE things and no more:
   *
   *  1. `git init` in the open folder, honouring the user's own
   *     `init.defaultBranch` rather than forcing a branch name on them.
   *  2. Writes a starter `.gitignore` — but only when the folder does not
   *     already have one, which is never overwritten.
   *  3. Reports what it did, including the number of files now waiting.
   *
   * It does NOT stage or commit. An initial commit made on the user's behalf
   * would sweep up every file in the folder — including anything they have not
   * looked at — into permanent history, from a single click. Leaving the repo
   * empty means the panel's own Untracked list IS the review step: the user
   * sees exactly what is about to go in, can discard or ignore anything that
   * should not, and then commits with the commit box like any other commit. The
   * cost is a repo with no HEAD for a few minutes, which the panel labels
   * plainly ("no commits yet") and every operation here already tolerates.
   *
   * Refuses (rather than nesting a second repo) when the folder is already
   * inside a working tree, and translates a missing `git` into a sentence that
   * says so.
   */
  async init(): Promise<GitInitResult> {
    const dir = this.dir
    if (!dir) throw new Error('No folder is open. Open a folder first, then initialise it.')

    // Nesting a repo inside a repo is almost never meant, and is fiddly to
    // unpick afterwards — refuse and name the repository that already covers
    // this folder. (The panel only offers the button when status says
    // `isRepo:false`, so this is a guard against a stale view, not the norm.)
    const existing = await this.repoRoot()
    if (existing) {
      // git reports the RESOLVED path, so compare like with like — otherwise a
      // folder reached through a symlink (every macOS temp dir, and plenty of
      // real home directories) reads as "inside" itself.
      const here = await realpath(dir).catch(() => dir)
      throw new Error(
        existing === here
          ? `${dir} is already a Git repository.`
          : `${dir} is already inside the Git repository at ${existing}. Initialising here would nest a second repository inside it.`
      )
    }

    const git = this.require()
    try {
      await git.init()
    } catch (err) {
      throw new Error(`Could not create a repository in ${dir} — ${gitFailureText(err)}`)
    }

    // Rebind to the repository we just created (it is its own root now).
    const root = (await this.openRepo(dir)) ?? dir

    // Starter .gitignore, only when the folder does not already have one. A
    // failure here is a warning, not an error: the repository exists either way
    // and saying "init failed" would be a lie.
    let wroteGitignore = false
    let warning: string | undefined
    const ignorePath = join(root, '.gitignore')
    try {
      await access(ignorePath, fsConstants.F_OK)
    } catch {
      try {
        await writeFile(ignorePath, SNAKIE_GITIGNORE, 'utf-8')
        wroteGitignore = true
      } catch (err) {
        warning = `The repository was created, but the starter .gitignore could not be written: ${gitFailureText(err)}`
      }
    }

    const after = await this.status()
    const branch = after.branch
    const untrackedCount = after.untracked.length

    return {
      root,
      branch,
      wroteGitignore,
      untrackedCount,
      warning,
      summary: initSummary({ branch, wroteGitignore, untrackedCount })
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
