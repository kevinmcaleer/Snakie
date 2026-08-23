import { ipcMain } from 'electron'
import type { IpcResult } from '../device/types'
import { GitService } from './GitService'
import type {
  GitBranchList,
  GitDiff,
  GitInitResult,
  GitPublishOptions,
  GitPublishPreflight,
  GitPublishResult,
  GitRemoteResult,
  GitStageResult,
  GitStageScope,
  GitStatus
} from './types'

/**
 * IPC for the built-in version-control (Git) layer (issue #15).
 *
 * All git operations run here in the main process via `simple-git`, scoped to a
 * single repository directory the user picks in the renderer (reusing the
 * existing `fs.openFolderDialog`). The handlers mirror the device/fs/packages
 * convention: each returns a serializable {@link IpcResult} that the preload
 * unwraps into a value or a thrown Error.
 *
 * The not-a-git-repository case is NOT an error: `git:status` resolves with
 * `{ isRepo:false }` so the panel can render a clear empty state. Only genuine
 * git failures (push/pull/checkout) reject across the boundary.
 */

/**
 * Wrap an async operation so any thrown error crosses IPC as a plain,
 * serializable {@link IpcResult}. Mirrors the other layers' `wrap` helper.
 */
async function wrap<T>(fn: () => Promise<T>): Promise<IpcResult<T>> {
  try {
    return { ok: true, value: await fn() }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Register all `git:*` IPC handlers. Call once from the main process after the
 * app is ready. A single {@link GitService} instance is kept for the lifetime
 * of the process, retargeted whenever the user opens a different repo. There
 * are no push events, so unlike the device layer this takes no window resolver.
 */
export function registerGitIpc(): void {
  const service = new GitService()

  // Point the service at a chosen folder; returns the resolved repo root or
  // null when the folder is not inside a git working tree.
  ipcMain.handle('git:openRepo', (_e, path: string) =>
    wrap<string | null>(() => service.openRepo(path))
  )

  // Working-tree status (branch, ahead/behind, staged/changed/untracked).
  ipcMain.handle('git:status', () => wrap<GitStatus>(() => service.status()))

  // Create a repository in the open folder (issue #783). Unlike `git:status`,
  // this one DOES reject on failure — the user asked for a write to their disk,
  // so "git isn't installed" or "this folder is already inside a repo" has to
  // reach them as words, not as a button that appears to do nothing.
  ipcMain.handle('git:init', () => wrap<GitInitResult>(() => service.init()))

  ipcMain.handle('git:stage', (_e, file: string) =>
    wrap<void>(() => service.stage(file))
  )

  // Stage a whole group at once (issue #794). Like `git:init` this DOES reject
  // on failure: the user asked for a bulk change to the index and a button that
  // appears to do nothing is worse than an error message.
  ipcMain.handle('git:stageAll', (_e, scope?: GitStageScope) =>
    wrap<GitStageResult>(() => service.stageAll(scope ?? 'untracked'))
  )
  ipcMain.handle('git:unstage', (_e, file: string) =>
    wrap<void>(() => service.unstage(file))
  )
  ipcMain.handle('git:discard', (_e, file: string) =>
    wrap<void>(() => service.discard(file))
  )

  ipcMain.handle('git:commit', (_e, message: string, stageAll?: boolean) =>
    wrap<void>(() => service.commit(message, stageAll ?? true))
  )

  ipcMain.handle('git:diff', (_e, file: string, staged?: boolean) =>
    wrap<GitDiff>(() => service.diff(file, staged ?? false))
  )

  ipcMain.handle('git:currentBranch', () =>
    wrap<string | undefined>(() => service.currentBranch())
  )
  ipcMain.handle('git:listBranches', () =>
    wrap<GitBranchList>(() => service.listBranches())
  )
  ipcMain.handle('git:checkout', (_e, branch: string) =>
    wrap<void>(() => service.checkout(branch))
  )

  ipcMain.handle('git:push', () => wrap<GitRemoteResult>(() => service.push()))
  ipcMain.handle('git:pull', () => wrap<GitRemoteResult>(() => service.pull()))

  // Everything the publish dialog needs before it opens (#795). Like
  // `git:status` this does NOT reject for the states it exists to report — a
  // missing `gh`, a signed-out CLI and a repo with no commits all come back as
  // `blockers`, because they are things the dialog renders rather than errors.
  ipcMain.handle('git:publishPreflight', () =>
    wrap<GitPublishPreflight>(() => service.publishPreflight())
  )

  // Create the GitHub repository and push to it (#795). This one DOES reject:
  // it creates a repository on the user's GitHub account, and a button that
  // appears to do nothing after that is the worst possible outcome — the user
  // would click it again and hit "name already exists" on their second try.
  ipcMain.handle('git:publish', (_e, options: GitPublishOptions) =>
    wrap<GitPublishResult>(() => service.publish(options))
  )
}
