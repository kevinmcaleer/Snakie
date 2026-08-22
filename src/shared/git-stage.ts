/**
 * Pure helpers behind the Source Control panel's bulk "stage" buttons (#794).
 *
 * Lives in `shared/` rather than `main/git/` because BOTH sides need the same
 * arithmetic: the main process uses it to decide what `git add` actually
 * receives, and the renderer uses it to write the button's label. If those two
 * ever disagreed the label would be a lie — a button reading "Stage 12
 * untracked" that stages 13 files is exactly the kind of bulk surprise this
 * feature has to avoid. One function, one answer, used by both.
 *
 * Deliberately free of `simple-git`, `fs` and Electron so it is directly
 * unit-testable (the same shape as `main/git/init-support.ts` for #783).
 */

/**
 * Which group of files a bulk stage covers.
 *
 * - `untracked` — files git has never seen (the panel's *Untracked* list).
 * - `changed`   — tracked files with working-tree edits (the *Changes* list).
 * - `all`       — both of the above, in that panel order.
 */
export type GitStageScope = 'untracked' | 'changed' | 'all'

/** The minimum a file must expose to be considered for bulk staging. */
export interface StageableFile {
  /** Repo-relative path, exactly as `git status` reported it. */
  path: string
  /** UI classification; only `'conflicted'` changes the outcome here. */
  kind?: string
}

/**
 * The subset of `GitStatus` these helpers read. Structural rather than an
 * import of the main-process type, so `shared/` stays dependency-free.
 */
export interface StageableStatus {
  changed: readonly StageableFile[]
  untracked: readonly StageableFile[]
}

/**
 * The repo-relative paths a bulk stage of `scope` would hand to `git add`.
 *
 * Two rules, both deliberate:
 *
 *  1. **Conflicted files are never included.** `git add` on a conflicted file
 *     is how you tell git "I resolved this" — doing that in bulk would mark a
 *     merge resolved with the `<<<<<<<` markers still sitting in the file, and
 *     the next commit would bake them into history. Conflicts stay in the list
 *     with their own per-file stage button, which is a decision the user makes
 *     one file at a time and on purpose.
 *  2. **Nothing is invented.** The paths come from the status the panel is
 *     already showing, so the button can only ever stage files the user can
 *     see. It never walks the disk itself, which is also why `.gitignore` needs
 *     no handling here — `git status` has already applied it (see
 *     `test/gitStageAll.test.ts`, which proves that against the real binary).
 *
 * Returns paths de-duplicated and in panel order (changes, then untracked).
 */
export function pathsToStage(status: StageableStatus, scope: GitStageScope): string[] {
  const groups: readonly (readonly StageableFile[])[] =
    scope === 'untracked'
      ? [status.untracked]
      : scope === 'changed'
        ? [status.changed]
        : [status.changed, status.untracked]

  const seen = new Set<string>()
  const paths: string[] = []
  for (const group of groups) {
    for (const file of group) {
      // A file staged AND further edited appears in both `staged` and
      // `changed`; `changed` is the side we want, and the dedupe below keeps
      // it from being passed to git twice.
      if (file.kind === 'conflicted') continue
      if (!file.path || seen.has(file.path)) continue
      seen.add(file.path)
      paths.push(file.path)
    }
  }
  return paths
}

/** How many files a bulk stage of `scope` would actually stage. */
export function stageableCount(status: StageableStatus, scope: GitStageScope): number {
  return pathsToStage(status, scope).length
}

/** English pluralisation for the small counts this feature deals in. */
function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many
}

/**
 * The button's visible label.
 *
 * The count is IN the label on purpose. It is the honest description of what
 * one click does, and it doubles as the brake: "Stage 3 untracked" invites a
 * click, "Stage 412 untracked" makes you stop and look at the list first. That
 * is why there is no confirmation dialog — the label already asked the
 * question, and unlike #783's button this writes nothing to disk (staging is
 * git's own index, and is undone by the per-file unstage button already here).
 */
export function stageActionLabel(scope: GitStageScope, count: number): string {
  if (scope === 'untracked') return `Stage ${count} untracked`
  if (scope === 'changed') return `Stage ${count} ${plural(count, 'change', 'changes')}`
  return `Stage ${count} ${plural(count, 'file', 'files')}`
}

/**
 * The button's tooltip: the full sentence the short label cannot fit.
 *
 * When conflicted files were held back, it says so — otherwise the group header
 * ("Changes (5)") and the button ("Stage 4 changes") would disagree with no
 * explanation, which reads as a bug rather than as the safety measure it is.
 */
export function stageActionTitle(
  scope: GitStageScope,
  count: number,
  conflicted = 0
): string {
  const what =
    scope === 'untracked'
      ? `${count} untracked ${plural(count, 'file', 'files')}`
      : scope === 'changed'
        ? `${count} changed ${plural(count, 'file', 'files')}`
        : `${count} ${plural(count, 'file', 'files')}`
  const main = `Stage ${what} for the next commit. Files ignored by .gitignore are not included.`
  if (conflicted <= 0) return main
  return (
    `${main} ${conflicted} conflicted ${plural(conflicted, 'file is', 'files are')} left out — ` +
    'resolve and stage those individually, so a commit never captures unresolved conflict markers.'
  )
}

/**
 * The one-line report shown after a bulk stage, so the panel says what it did
 * rather than just quietly redrawing its lists.
 */
export function stageSummary(scope: GitStageScope, count: number): string {
  if (count === 0) return 'Nothing to stage.'
  const what =
    scope === 'untracked'
      ? `${count} untracked ${plural(count, 'file', 'files')}`
      : scope === 'changed'
        ? `${count} changed ${plural(count, 'file', 'files')}`
        : `${count} ${plural(count, 'file', 'files')}`
  return `Staged ${what}, ready to commit.`
}

/**
 * Split `paths` into batches small enough to survive a command line.
 *
 * `git add` is spawned with one argument per path, and Windows caps a whole
 * command line at ~32k characters — a folder with a few hundred untracked
 * files would blow past that and fail with something unreadable. Batching keeps
 * every invocation comfortably short on every platform.
 */
export function chunkPaths(paths: readonly string[], size = 100): string[][] {
  if (size < 1) throw new Error('chunk size must be at least 1')
  const out: string[][] = []
  for (let i = 0; i < paths.length; i += size) out.push(paths.slice(i, i + size))
  return out
}
