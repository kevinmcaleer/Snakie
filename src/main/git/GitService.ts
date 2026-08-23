import { constants as fsConstants } from 'fs'
import { access, realpath, writeFile } from 'fs/promises'
import { join } from 'path'
import { simpleGit, type SimpleGit, type StatusResult } from 'simple-git'
import {
  chunkPaths,
  pathsToStage,
  stageSummary,
  type GitStageScope
} from '../../shared/git-stage'
import {
  publishArgs,
  publishSummary,
  secretRisks,
  suggestRepoName,
  validateRepoName,
  type GitVisibility
} from '../../shared/git-publish'
import { ghAccount, ghVersion, publishTimeout, runGh } from './gh'
import { SNAKIE_GITIGNORE, gitFailureText, initSummary } from './init-support'
import type {
  GitBranchList,
  GitDiff,
  GitFileStatus,
  GitInitResult,
  GitPublishOptions,
  GitPublishPreflight,
  GitPublishResult,
  GitRemoteResult,
  GitStageResult,
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
      hasCommits: false,
      remotes: []
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
      hasCommits: await this.hasCommits(),
      remotes: await this.remotes()
    }
  }

  /**
   * Names of the configured remotes, or `[]` when there are none.
   *
   * Never throws: a repo with no remotes is the normal state this feature
   * exists for (#795), not a failure, and a status refresh that rejected
   * because of it would break the whole panel over a missing `origin`.
   */
  private async remotes(): Promise<string[]> {
    const git = this.git
    if (!git) return []
    try {
      const list = await git.getRemotes(false)
      return list.map((r) => r.name).filter(Boolean)
    } catch {
      return []
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

  /**
   * Everything the publish dialog needs to know before it opens (#795).
   *
   * Answers the four questions that decide whether a publish can happen at all
   * — is `gh` installed, is it signed in, is there anything to push, and does
   * this repo already have a remote — plus the two that shape what the dialog
   * shows: a sanitised starting name, and which tracked files would be a bad
   * thing to make public.
   *
   * Never throws for any of those states. They are all things the dialog
   * RENDERS: a missing `gh` should read as a sentence with an install link, not
   * as a red error bar under a form the user cannot use anyway.
   */
  async publishPreflight(): Promise<GitPublishPreflight> {
    const blockers: string[] = []

    const version = await ghVersion()
    const ghInstalled = version !== undefined
    if (!ghInstalled) {
      blockers.push(
        'The GitHub CLI (gh) is not installed on this computer, or is not on its PATH. ' +
          'Snakie publishes through gh so it never has to hold your GitHub credentials — ' +
          'install it from https://cli.github.com, then restart Snakie.'
      )
    }

    // Only worth asking when there is a binary to ask.
    let authenticated = false
    let account: string | undefined
    if (ghInstalled) {
      try {
        account = await ghAccount()
        authenticated = true
      } catch {
        authenticated = false
        blockers.push(
          'The GitHub CLI is not signed in. Open a terminal, run `gh auth login`, then try ' +
            'again. Snakie cannot run that sign-in for you — it is interactive on purpose, ' +
            'so your credentials only ever go to GitHub.'
        )
      }
    }

    const current = await this.status()
    if (!current.isRepo) {
      blockers.push('This folder is not a Git repository yet. Initialise one first.')
    }

    // Publishing an unborn HEAD would create an empty repository on GitHub and
    // push nothing — the user would be left with a repo that does not contain
    // their project and no clue why.
    if (current.isRepo && !current.hasCommits) {
      blockers.push(
        'There are no commits yet, so there would be nothing to publish. ' +
          'Stage your files and make a first commit, then publish.'
      )
    }

    const existingRemote = current.remotes[0]
    if (existingRemote) {
      blockers.push(
        `This repository already has a remote ("${existingRemote}"), so it is already published ` +
          'somewhere. Use Push to send your commits there.'
      )
    }

    const root = current.root ?? this.dir ?? ''
    const folderName = root.split(/[\\/]/).filter(Boolean).pop() ?? ''

    return {
      ghInstalled,
      ghVersion: version,
      authenticated,
      account,
      suggestedName: suggestRepoName(folderName),
      hasCommits: current.hasCommits,
      existingRemote,
      riskyPaths: current.isRepo ? secretRisks(await this.trackedPaths()) : [],
      blockers
    }
  }

  /**
   * The repo-relative paths git is TRACKING.
   *
   * Tracking is the right question, not "what is in the folder": an untracked
   * or ignored `secrets.py` is never pushed, so warning about it would be a
   * false alarm — and false alarms are how a warning gets clicked through.
   */
  private async trackedPaths(): Promise<string[]> {
    const git = this.git
    if (!git) return []
    try {
      const out = await git.raw(['ls-files'])
      return out.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    } catch {
      return []
    }
  }

  /**
   * Create a GitHub repository from the open folder and push to it (#795).
   *
   * The whole operation is `gh repo create --source … --push`, which creates
   * the remote repository, adds it as a git remote and pushes the current
   * branch in one step. Doing it as one `gh` call rather than three of our own
   * is deliberate: any split leaves failure states that are genuinely hard for
   * a user to unpick (a repository created on GitHub but no remote locally, or
   * a remote pointing at a repository that was never created).
   *
   * Everything is re-checked here rather than trusted from the dialog's
   * preflight. The two are separated by however long the user spent typing, and
   * in that window they could have committed, added a remote, or opened a
   * different folder — and unlike a stale button, a stale publish creates a
   * real repository on a real account.
   */
  async publish(options: GitPublishOptions): Promise<GitPublishResult> {
    const visibility: GitVisibility = options.visibility === 'public' ? 'public' : 'private'

    const check = validateRepoName(options.name)
    if (!check.ok) throw new Error(check.error ?? 'That repository name is not valid.')

    const current = await this.status()
    if (!current.isRepo || !current.root) {
      throw new Error('This folder is not a Git repository, so there is nothing to publish.')
    }
    if (!current.hasCommits) {
      throw new Error(
        'There are no commits yet, so there would be nothing to publish. Make a first commit, then publish.'
      )
    }
    const existing = current.remotes[0]
    if (existing) {
      throw new Error(
        `This repository already has a remote ("${existing}"), so it is already published somewhere. ` +
          'Use Push to send your commits there.'
      )
    }

    const root = current.root
    const branch = current.branch

    await runGh(
      publishArgs({
        name: options.name.trim(),
        description: options.description,
        visibility,
        source: root
      }),
      { cwd: root, timeout: publishTimeout }
    )

    // What gh actually created — asked for rather than assumed, because the
    // owner half of `fullName` is resolved by gh (the authenticated user, when
    // the name was typed bare) and the visibility is worth reading back from
    // GitHub rather than echoing the flag we sent.
    let fullName = options.name.trim()
    let url = ''
    let confirmedVisibility = visibility
    let warning: string | undefined
    try {
      const { stdout } = await runGh([
        'repo',
        'view',
        '--json',
        'nameWithOwner,url,visibility'
      ], { cwd: root })
      const meta = JSON.parse(stdout) as {
        nameWithOwner?: string
        url?: string
        visibility?: string
      }
      if (meta.nameWithOwner) fullName = meta.nameWithOwner
      if (meta.url) url = meta.url
      if (meta.visibility) {
        confirmedVisibility = meta.visibility.toLowerCase() === 'public' ? 'public' : 'private'
      }
    } catch {
      // The repository exists and the push succeeded — this call is only for a
      // tidier report, so failing it must not turn a success into an error.
      warning = 'The repository was published, but Snakie could not read back its details from GitHub.'
    }

    // gh's `--push` sets the upstream itself, but say so out loud rather than
    // assume: without tracking, the panel's ahead/behind counts stay blank and
    // Push would fail with "no upstream" on the very next commit.
    const after = await this.status()
    const remote = after.remotes[0] ?? 'origin'
    if (!after.tracking && branch) {
      try {
        await this.require().raw(['branch', `--set-upstream-to=${remote}/${branch}`, branch])
      } catch {
        warning =
          warning ??
          `Published, but ${branch} is not tracking ${remote}/${branch} yet — the first Push may ask you to set an upstream.`
      }
    }

    if (confirmedVisibility !== visibility) {
      // Almost always an organisation policy forcing private. The user asked
      // for one thing and got another; that is not a detail to swallow.
      warning =
        `You asked for a ${visibility} repository, but GitHub created a ${confirmedVisibility} one ` +
        '(an organisation policy usually causes this).'
    }

    return {
      fullName,
      url: url || `https://github.com/${fullName}`,
      visibility: confirmedVisibility,
      branch,
      remote,
      warning,
      summary: publishSummary({ fullName, visibility: confirmedVisibility, branch, remote })
    }
  }

  /** Stage a single file (git add). */
  async stage(file: string): Promise<void> {
    await this.require().add([file])
  }

  /**
   * Stage a whole group of files in one go (issue #794).
   *
   * The paths come from {@link status} — the very list the panel is showing —
   * never from a directory walk of our own. Three things fall out of that, all
   * of them wanted:
   *
   *  - **`.gitignore` needs no code here.** `git status` has already applied
   *    every ignore rule (repo, global, and `.git/info/exclude`), so an ignored
   *    file cannot reach `git add`. That is also why this can pass explicit
   *    paths safely: `git add` REFUSES an explicitly-named ignored path and
   *    aborts the whole batch, which would have turned one stray `.DS_Store`
   *    into a button that always fails.
   *  - **What the label promised is what gets staged**, because the renderer
   *    sized that label with the same {@link pathsToStage}.
   *  - **Conflicted files are held back**, so a bulk click can never mark a
   *    merge resolved on the user's behalf.
   *
   * Note `-A` is deliberately NOT used: it would also stage deletions and
   * anything outside the requested group, which is precisely the "I clicked one
   * button and it staged everything" outcome this is shaped to avoid.
   */
  async stageAll(scope: GitStageScope = 'untracked'): Promise<GitStageResult> {
    const git = this.require()

    const current = await this.status()
    if (!current.isRepo) {
      throw new Error('This folder is not a Git repository, so there is nothing to stage.')
    }
    if (current.warning) {
      // status() could not be read fully; staging off a partial list would
      // stage a partial set without saying so.
      throw new Error(`Could not read the working tree, so nothing was staged — ${current.warning}`)
    }

    const paths = pathsToStage(current, scope)
    if (paths.length === 0) {
      return { scope, staged: 0, paths: [], summary: stageSummary(scope, 0) }
    }

    // Batched so a large folder cannot overflow the command line (see
    // chunkPaths). A failure mid-way leaves earlier batches staged, so the
    // message says how far it got rather than implying nothing happened.
    let done = 0
    for (const batch of chunkPaths(paths)) {
      try {
        await git.add([...batch])
        done += batch.length
      } catch (err) {
        const detail = gitFailureText(err)
        throw new Error(
          done === 0
            ? `Nothing was staged — ${detail}`
            : `Staged ${done} of ${paths.length} files, then stopped — ${detail}`
        )
      }
    }

    return { scope, staged: done, paths, summary: stageSummary(scope, done) }
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
