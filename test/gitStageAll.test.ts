import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { GitService } from '../src/main/git/GitService'
import {
  chunkPaths,
  pathsToStage,
  stageActionLabel,
  stageActionTitle,
  stageSummary,
  stageableCount,
  type GitStageScope
} from '../src/shared/git-stage'

/**
 * #794 — the Source Control pane's bulk "stage this group" buttons.
 *
 * The promises worth pinning down are behavioural, and two of them can only be
 * answered by the real `git` binary:
 *
 *  - **`.gitignore` is honoured.** Not because Snakie filters anything — it
 *    doesn't — but because the paths come from `git status`, which has already
 *    applied every ignore rule. Asserting that requires asking git, not
 *    asserting our own filter exists (there is no filter to assert).
 *  - **The label does not lie.** The count on the button and the number of
 *    files that end up in the index are produced by the same helper, so the
 *    test stages a group and then counts git's actual index.
 *  - Conflicted files are never bulk-staged, so a click can't mark a merge
 *    resolved with the conflict markers still in the file.
 *  - Nothing-to-stage is a result, not an error; a genuine git failure is a
 *    sentence, not a silent no-op.
 *
 * The repository half runs the REAL {@link GitService} against real temp
 * folders — the same seam `gitInit.test.ts` (#783) uses.
 */

/** True when a real `git` is on PATH; the repo-level suite needs one. */
function haveGit(): boolean {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/** Run git in `dir`, returning trimmed stdout. Throws on a non-zero exit. */
function git(dir: string, args: string[]): string {
  // stderr is swallowed: several assertions deliberately run a git command that
  // fails, and its "fatal: …" would otherwise clutter the test output.
  return execFileSync('git', args, {
    cwd: dir,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'ignore']
  }).trim()
}

/** The paths currently in git's index — the only authority on "staged". */
function indexPaths(dir: string): string[] {
  const out = git(dir, ['diff', '--cached', '--name-only'])
  return out ? out.split('\n') : []
}

const roots: string[] = []

/**
 * A repo holding a plausible Snakie project, mid-work: a committed file that
 * has since been edited, brand-new files, and clutter the `.gitignore` covers.
 */
function workingRepo(): string {
  // realpath: macOS temp dirs are symlinks (/var → /private/var) and git always
  // reports the resolved path, so compare like with like.
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'snakie-794-')))
  roots.push(dir)

  git(dir, ['init'])
  git(dir, ['config', 'user.email', 'test@example.com'])
  git(dir, ['config', 'user.name', 'Test'])

  // Ignored clutter, plus the rules that hide it.
  writeFileSync(join(dir, '.gitignore'), '__pycache__/\n*.pyc\nsecrets.env\nbuild/\n')

  // A tracked file, committed, so it can later be "changed".
  writeFileSync(join(dir, 'main.py'), 'print("hello")\n')
  writeFileSync(join(dir, 'robot.yml'), 'name: rover\n')
  git(dir, ['add', '.gitignore', 'main.py', 'robot.yml'])
  git(dir, ['commit', '-m', 'initial'])

  // Now the working state the panel would be showing:
  // — tracked files with unstaged edits
  writeFileSync(join(dir, 'main.py'), 'print("hello, world")\n')
  writeFileSync(join(dir, 'robot.yml'), 'name: rover2\n')
  // — untracked files, including one nested in a new folder
  writeFileSync(join(dir, 'arm.urdf'), '<robot name="arm"/>\n')
  mkdirSync(join(dir, 'meshes'))
  writeFileSync(join(dir, 'meshes', 'wheel.stl'), 'solid wheel\n')
  // — ignored clutter that must never reach the index
  mkdirSync(join(dir, '__pycache__'))
  writeFileSync(join(dir, '__pycache__', 'main.cpython-311.pyc'), 'bytecode\n')
  writeFileSync(join(dir, 'secrets.env'), 'TOKEN=hunter2\n')
  mkdirSync(join(dir, 'build'))
  writeFileSync(join(dir, 'build', 'out.bin'), 'binary\n')

  return dir
}

afterAll(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** A status shaped like the panel's, for the pure helpers. */
const status = {
  changed: [
    { path: 'main.py', kind: 'modified' },
    { path: 'robot.yml', kind: 'modified' },
    { path: 'merge.py', kind: 'conflicted' }
  ],
  untracked: [
    { path: 'arm.urdf', kind: 'untracked' },
    { path: 'meshes/wheel.stl', kind: 'untracked' }
  ]
}

describe('pathsToStage', () => {
  it('stages only the untracked group for the untracked scope', () => {
    expect(pathsToStage(status, 'untracked')).toEqual(['arm.urdf', 'meshes/wheel.stl'])
  })

  it('stages only tracked edits for the changed scope', () => {
    expect(pathsToStage(status, 'changed')).toEqual(['main.py', 'robot.yml'])
  })

  it('stages both groups, changes first, for the all scope', () => {
    expect(pathsToStage(status, 'all')).toEqual([
      'main.py',
      'robot.yml',
      'arm.urdf',
      'meshes/wheel.stl'
    ])
  })

  it('never includes a conflicted file, in any scope', () => {
    for (const scope of ['untracked', 'changed', 'all'] as GitStageScope[]) {
      expect(pathsToStage(status, scope)).not.toContain('merge.py')
    }
  })

  it('de-duplicates a path listed in both groups', () => {
    const both = {
      changed: [{ path: 'a.py', kind: 'modified' }],
      untracked: [{ path: 'a.py', kind: 'untracked' }]
    }
    expect(pathsToStage(both, 'all')).toEqual(['a.py'])
  })

  it('returns nothing for empty groups', () => {
    const empty = { changed: [], untracked: [] }
    for (const scope of ['untracked', 'changed', 'all'] as GitStageScope[]) {
      expect(pathsToStage(empty, scope)).toEqual([])
      expect(stageableCount(empty, scope)).toBe(0)
    }
  })

  it('counts exactly what it would stage', () => {
    expect(stageableCount(status, 'untracked')).toBe(2)
    // Three files in the Changes list, but only two are stageable — the
    // header count and the button count are ALLOWED to differ, and the
    // tooltip is what explains why.
    expect(status.changed).toHaveLength(3)
    expect(stageableCount(status, 'changed')).toBe(2)
  })
})

describe('stageActionLabel', () => {
  it('makes untracked and changed visibly different promises', () => {
    expect(stageActionLabel('untracked', 3)).toBe('Stage 3 untracked')
    expect(stageActionLabel('changed', 3)).toBe('Stage 3 changes')
    expect(stageActionLabel('untracked', 3)).not.toBe(stageActionLabel('changed', 3))
  })

  it('always carries the count, so a bulk click is never a surprise', () => {
    for (const scope of ['untracked', 'changed', 'all'] as GitStageScope[]) {
      expect(stageActionLabel(scope, 412)).toContain('412')
      expect(stageActionLabel(scope, 1)).toContain('1')
    }
  })

  it('reads correctly for a single file', () => {
    expect(stageActionLabel('changed', 1)).toBe('Stage 1 change')
    expect(stageActionLabel('all', 1)).toBe('Stage 1 file')
    expect(stageActionLabel('all', 2)).toBe('Stage 2 files')
  })
})

describe('stageActionTitle', () => {
  it('says that ignored files are not included', () => {
    expect(stageActionTitle('untracked', 3)).toMatch(/\.gitignore/)
  })

  it('explains held-back conflicts, so the count mismatch is not read as a bug', () => {
    const text = stageActionTitle('changed', 2, 1)
    expect(text).toMatch(/conflicted/i)
    expect(text).toMatch(/individually/i)
  })

  it('stays quiet about conflicts when there are none', () => {
    expect(stageActionTitle('changed', 2, 0)).not.toMatch(/conflicted/i)
  })
})

describe('stageSummary', () => {
  it('reports nothing-to-stage as a plain statement, not a failure', () => {
    for (const scope of ['untracked', 'changed', 'all'] as GitStageScope[]) {
      expect(stageSummary(scope, 0)).toBe('Nothing to stage.')
    }
  })

  it('names the count and the group it staged', () => {
    expect(stageSummary('untracked', 3)).toMatch(/3 untracked files/)
    expect(stageSummary('changed', 1)).toMatch(/1 changed file/)
    expect(stageSummary('all', 5)).toMatch(/5 files/)
  })
})

describe('chunkPaths', () => {
  it('keeps every path, in order, across batches', () => {
    const paths = Array.from({ length: 250 }, (_, i) => `file-${i}.py`)
    const batches = chunkPaths(paths, 100)
    expect(batches).toHaveLength(3)
    expect(batches.map((b) => b.length)).toEqual([100, 100, 50])
    expect(batches.flat()).toEqual(paths)
  })

  it('returns no batches at all for no paths, so git is never called empty-handed', () => {
    expect(chunkPaths([])).toEqual([])
  })

  it('rejects a nonsensical batch size rather than looping forever', () => {
    expect(() => chunkPaths(['a'], 0)).toThrow(/at least 1/)
  })
})

// ---------------------------------------------------------------------------
// IPC wiring — the #783 bug class: a button whose handler was never registered
// ---------------------------------------------------------------------------

describe('git IPC registration', () => {
  it('registers a handler for every git channel the preload invokes', async () => {
    const handlers = new Set<string>()
    vi.doMock('electron', () => ({
      ipcMain: {
        handle: (channel: string) => {
          handlers.add(channel)
        }
      }
    }))

    const { registerGitIpc } = await import('../src/main/git/ipc')
    registerGitIpc()

    // Every `git:*` channel the preload bridge actually calls, read from the
    // preload source itself so this cannot drift out of date.
    const preload = readFileSync(
      join(__dirname, '..', 'src', 'preload', 'index.ts'),
      'utf-8'
    )
    const invoked = [...preload.matchAll(/ipcRenderer\.invoke\(\s*'(git:[^']+)'/g)].map(
      (m) => m[1]
    )

    expect(invoked.length).toBeGreaterThan(0)
    // The feature this file is about, called out by name so a regression here
    // reads as "the stage-all button is dead" rather than a count mismatch.
    expect(invoked).toContain('git:stageAll')
    expect(handlers).toContain('git:stageAll')
    for (const channel of invoked) {
      expect(handlers, `${channel} is invoked by the preload but never registered`).toContain(
        channel
      )
    }

    vi.doUnmock('electron')
  })
})

// ---------------------------------------------------------------------------
// Against a real git binary
// ---------------------------------------------------------------------------

describe.skipIf(!haveGit())('GitService.stageAll against a real git', () => {
  let service: GitService
  let dir: string

  beforeEach(async () => {
    service = new GitService()
    dir = workingRepo()
    await service.openRepo(dir)
  })

  it('stages the untracked files and leaves tracked edits alone', async () => {
    const result = await service.stageAll('untracked')

    expect(result.scope).toBe('untracked')
    expect(result.paths.sort()).toEqual(['arm.urdf', 'meshes/wheel.stl'])
    expect(result.staged).toBe(2)
    expect(result.summary).toMatch(/2 untracked files/)

    // git's own index agrees, and the edited tracked files were NOT swept in.
    expect(indexPaths(dir).sort()).toEqual(['arm.urdf', 'meshes/wheel.stl'])

    const after = await service.status()
    expect(after.untracked).toHaveLength(0)
    expect(after.staged.map((f) => f.path).sort()).toEqual(['arm.urdf', 'meshes/wheel.stl'])
    // Still waiting, untouched — the button promised untracked only.
    expect(after.changed.map((f) => f.path).sort()).toEqual(['main.py', 'robot.yml'])
  })

  it('honours .gitignore — because git status never offered the ignored files', async () => {
    const result = await service.stageAll('all')

    const staged = indexPaths(dir)
    for (const ignored of [
      '__pycache__/main.cpython-311.pyc',
      'secrets.env',
      'build/out.bin'
    ]) {
      expect(staged, `${ignored} must not be staged`).not.toContain(ignored)
      expect(result.paths).not.toContain(ignored)
    }
    // And the real project files did make it.
    expect(staged).toContain('arm.urdf')
    expect(staged).toContain('meshes/wheel.stl')
    expect(staged).toContain('main.py')
  })

  it('adding an ignored path explicitly is an error — which is why we never do', () => {
    // The reason `stageAll` takes its paths from `git status` rather than
    // walking the disk and filtering: git REFUSES a named ignored path and
    // aborts the whole batch, so one stray `secrets.env` would have made the
    // button fail every time instead of quietly skipping it.
    expect(() => git(dir, ['add', '--', 'secrets.env'])).toThrow()
    expect(indexPaths(dir)).not.toContain('secrets.env')
  })

  it('stages tracked edits only, for the changed scope', async () => {
    const result = await service.stageAll('changed')

    expect(result.paths.sort()).toEqual(['main.py', 'robot.yml'])
    expect(indexPaths(dir).sort()).toEqual(['main.py', 'robot.yml'])

    const after = await service.status()
    expect(after.changed).toHaveLength(0)
    // Untracked files are exactly where they were.
    expect(after.untracked.map((f) => f.path).sort()).toEqual(['arm.urdf', 'meshes/wheel.stl'])
  })

  it('stages both groups for the all scope', async () => {
    const result = await service.stageAll('all')

    expect(result.staged).toBe(4)
    expect(indexPaths(dir).sort()).toEqual([
      'arm.urdf',
      'main.py',
      'meshes/wheel.stl',
      'robot.yml'
    ])
    const after = await service.status()
    expect(after.changed).toHaveLength(0)
    expect(after.untracked).toHaveLength(0)
  })

  it('the number on the button is the number git ends up with', async () => {
    // The label's count and the staged count come from the same helper, so
    // this is the end-to-end version of "the label must not lie".
    const before = await service.status()
    const promised = pathsToStage(before, 'all').length

    const result = await service.stageAll('all')

    expect(result.staged).toBe(promised)
    expect(indexPaths(dir)).toHaveLength(promised)
  })

  it('reports nothing-to-stage as a result rather than throwing', async () => {
    await service.stageAll('all')
    const again = await service.stageAll('all')

    expect(again.staged).toBe(0)
    expect(again.paths).toEqual([])
    expect(again.summary).toBe('Nothing to stage.')
  })

  it('never bulk-stages a conflicted file', async () => {
    // Build a real merge conflict on top of the fixture repo.
    await service.stageAll('all')
    git(dir, ['commit', '-m', 'work in progress'])
    const base = git(dir, ['rev-parse', '--abbrev-ref', 'HEAD'])

    git(dir, ['checkout', '-b', 'other'])
    writeFileSync(join(dir, 'main.py'), 'print("from other")\n')
    git(dir, ['commit', '-am', 'other side'])

    git(dir, ['checkout', base])
    writeFileSync(join(dir, 'main.py'), 'print("from base")\n')
    git(dir, ['commit', '-am', 'base side'])

    // Conflicts, so git exits non-zero — that is the point.
    expect(() => git(dir, ['merge', 'other'])).toThrow()
    writeFileSync(join(dir, 'fresh.py'), 'pass\n')

    const before = await service.status()
    expect(before.changed.some((f) => f.kind === 'conflicted')).toBe(true)

    const result = await service.stageAll('all')

    // The new file went in; the conflict did not get marked resolved.
    expect(result.paths).toContain('fresh.py')
    expect(result.paths).not.toContain('main.py')
    const stillConflicted = await service.status()
    expect(stillConflicted.changed.some((f) => f.path === 'main.py' && f.kind === 'conflicted')).toBe(
      true
    )
    // The conflict markers are still in the file, unresolved and uncommitted.
    expect(readFileSync(join(dir, 'main.py'), 'utf-8')).toContain('<<<<<<<')
  })

  it('refuses, in words, when the folder is not a repository', async () => {
    const plain = realpathSync(mkdtempSync(join(tmpdir(), 'snakie-794-plain-')))
    roots.push(plain)
    writeFileSync(join(plain, 'notes.txt'), 'hi\n')

    const other = new GitService()
    await other.openRepo(plain)

    await expect(other.stageAll('all')).rejects.toThrow(/not a Git repository/i)
  })

  it('refuses, in words, when no folder is open', async () => {
    await expect(new GitService().stageAll('all')).rejects.toThrow(/no folder is open/i)
  })

  it('stages a large batch in full, across command-line chunks', async () => {
    // 250 files is past the single-invocation batch size, so this exercises the
    // chunking that keeps a big folder from overflowing the command line.
    for (let i = 0; i < 250; i++) writeFileSync(join(dir, `gen-${i}.py`), `X = ${i}\n`)

    const result = await service.stageAll('untracked')

    expect(result.staged).toBe(252) // 250 generated + arm.urdf + meshes/wheel.stl
    expect(indexPaths(dir)).toHaveLength(252)
    expect((await service.status()).untracked).toHaveLength(0)
  })
})
