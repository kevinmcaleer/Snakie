import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { GitService } from '../src/main/git/GitService'
import { SNAKIE_GITIGNORE, gitFailureText, initSummary } from '../src/main/git/init-support'

/**
 * #783 — "Initialise Repository" in the Source Control pane.
 *
 * The button writes to the user's disk, so the things worth pinning down are
 * behavioural promises rather than implementation details:
 *
 *  - it creates a repository and NOTHING ELSE gets committed on the user's behalf;
 *  - the starter `.gitignore` hides machine clutter and keeps project files —
 *    especially the `meshes/` a URDF needs — visible to git;
 *  - an existing `.gitignore` is never overwritten;
 *  - the failure modes (already a repo, nested inside one, no folder open, no
 *    git installed) come back as sentences, never as a silent no-op.
 *
 * The repository half runs the REAL {@link GitService} against real temp folders
 * and the real `git` binary — the same seam `partWriteGuard.test.ts` uses —
 * because "did git actually ignore this path" is only answerable by asking git.
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
  // stderr is swallowed: several assertions here deliberately run a git command
  // that fails, and its "fatal: …" would otherwise clutter the test output.
  return execFileSync('git', args, {
    cwd: dir,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'ignore']
  }).trim()
}

/** `git check-ignore` is the only authority on whether a path is ignored. */
function isIgnored(dir: string, path: string): boolean {
  try {
    execFileSync('git', ['check-ignore', '-q', '--', path], { cwd: dir, stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

const roots: string[] = []

/**
 * A folder holding a plausible Snakie project: source, a robot definition, a
 * URDF with the meshes it references, a vendored driver, and the clutter that
 * accumulates beside them.
 */
function projectFolder(): string {
  // realpath: macOS temp dirs are symlinks (/var → /private/var) and git always
  // reports the resolved path, so compare like with like.
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'snakie-783-')))
  roots.push(dir)
  writeFileSync(join(dir, 'main.py'), 'print("hello")\n')
  writeFileSync(join(dir, 'robot.yml'), 'name: rover\n')
  writeFileSync(join(dir, 'arm.urdf'), '<robot name="arm"/>\n')
  mkdirSync(join(dir, 'meshes'))
  writeFileSync(join(dir, 'meshes', 'wheel.stl'), 'solid wheel\n')
  mkdirSync(join(dir, 'lib'))
  writeFileSync(join(dir, 'lib', 'driver.py'), 'X = 1\n')
  writeFileSync(join(dir, 'lib', 'accel.mpy'), 'binary-ish\n')
  mkdirSync(join(dir, '__pycache__'))
  writeFileSync(join(dir, '__pycache__', 'main.cpython-311.pyc'), 'bytecode\n')
  writeFileSync(join(dir, '.DS_Store'), 'finder junk\n')
  writeFileSync(join(dir, 'robot.yml.bak'), 'name: rover\n')
  return dir
}

afterAll(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true })
})

describe('gitFailureText', () => {
  it('turns a missing git binary into an actionable sentence', () => {
    const text = gitFailureText(new Error('spawn git ENOENT'))
    expect(text).toMatch(/not installed/i)
    expect(text).toContain('git-scm.com')
    // The raw spawn wording must not survive — it reads as a Snakie crash.
    expect(text).not.toContain('ENOENT')
  })

  it('recognises the Windows shell wording for a missing git', () => {
    const text = gitFailureText(new Error("'git' is not recognized as an internal or external command"))
    expect(text).toMatch(/not installed/i)
  })

  it('passes a real git message through rather than paraphrasing it', () => {
    const real = "fatal: your current branch 'main' does not have any commits yet"
    expect(gitFailureText(new Error(real))).toBe(real)
  })

  it('handles a non-Error rejection without losing the text', () => {
    expect(gitFailureText('permission denied')).toBe('permission denied')
  })
})

describe('initSummary', () => {
  it('always states that nothing was committed', () => {
    for (const input of [
      { branch: 'main', wroteGitignore: true, untrackedCount: 7 },
      { branch: undefined, wroteGitignore: false, untrackedCount: 0 },
      { branch: 'trunk', wroteGitignore: false, untrackedCount: 1 }
    ]) {
      expect(initSummary(input)).toMatch(/nothing has been committed/i)
    }
  })

  it('names the branch when git reported one', () => {
    expect(initSummary({ branch: 'main', wroteGitignore: true, untrackedCount: 3 })).toContain('main')
  })

  it('only mentions a .gitignore when one was actually written', () => {
    expect(initSummary({ branch: 'main', wroteGitignore: true, untrackedCount: 3 })).toContain('.gitignore')
    expect(initSummary({ branch: 'main', wroteGitignore: false, untrackedCount: 3 })).not.toContain(
      '.gitignore'
    )
  })

  it('counts files in readable English', () => {
    expect(initSummary({ branch: 'main', wroteGitignore: false, untrackedCount: 1 })).toContain('1 file ')
    expect(initSummary({ branch: 'main', wroteGitignore: false, untrackedCount: 4 })).toContain('4 files ')
    expect(initSummary({ branch: 'main', wroteGitignore: false, untrackedCount: 0 })).toMatch(
      /nothing to commit yet/i
    )
  })
})

describe.skipIf(!haveGit())('GitService.init against a real git', () => {
  let service: GitService
  let dir: string

  beforeEach(() => {
    service = new GitService()
    dir = projectFolder()
  })

  it('creates a repository and commits nothing', async () => {
    expect(await service.openRepo(dir)).toBeNull()
    const before = await service.status()
    expect(before.isRepo).toBe(false)

    const result = await service.init()

    expect(result.root).toBe(dir)
    // The repository exists and git agrees it is the top level.
    expect(git(dir, ['rev-parse', '--show-toplevel'])).toBe(dir)
    // …and there is no history: the first commit is still the user's to make.
    expect(() => git(dir, ['rev-parse', '--verify', 'HEAD'])).toThrow()
    expect(git(dir, ['log', '--oneline', '--all'])).toBe('')

    const after = await service.status()
    expect(after.isRepo).toBe(true)
    expect(after.hasCommits).toBe(false)
    expect(after.staged).toHaveLength(0)
    expect(after.changed).toHaveLength(0)
    // The user's files are waiting for them, visible and reviewable.
    expect(after.untracked.length).toBeGreaterThan(0)
    expect(result.untrackedCount).toBe(after.untracked.length)
    expect(result.summary).toMatch(/nothing has been committed/i)
  })

  it('starts on the branch git chose and reports it', async () => {
    await service.openRepo(dir)
    const result = await service.init()
    const branch = git(dir, ['symbolic-ref', '--short', 'HEAD'])
    expect(result.branch).toBe(branch)
    expect((await service.status()).branch).toBe(branch)
  })

  it('writes a .gitignore that hides clutter but keeps the project', async () => {
    await service.openRepo(dir)
    const result = await service.init()
    expect(result.wroteGitignore).toBe(true)
    expect(readFileSync(join(dir, '.gitignore'), 'utf-8')).toBe(SNAKIE_GITIGNORE)

    // Machine-generated clutter: git must not see it.
    for (const junk of ['__pycache__/main.cpython-311.pyc', '.DS_Store', 'robot.yml.bak']) {
      expect(isIgnored(dir, junk), `${junk} should be ignored`).toBe(true)
    }

    // The project itself — including the meshes a URDF is useless without, and
    // vendored drivers — must stay visible. A first commit that silently drops
    // these is the papercut this .gitignore exists to avoid causing.
    for (const kept of [
      'main.py',
      'robot.yml',
      'arm.urdf',
      'meshes/wheel.stl',
      'lib/driver.py',
      'lib/accel.mpy',
      '.gitignore'
    ]) {
      expect(isIgnored(dir, kept), `${kept} should NOT be ignored`).toBe(false)
    }

    // And the same, read back through the service the panel actually uses.
    const untracked = (await service.status()).untracked.map((f) => f.path)
    expect(untracked).toContain('meshes/wheel.stl')
    expect(untracked).toContain('.gitignore')
    expect(untracked.some((p) => p.includes('__pycache__'))).toBe(false)
    expect(untracked).not.toContain('.DS_Store')
  })

  it('never overwrites a .gitignore the folder already had', async () => {
    const mine = '# hands off\nsecrets.env\n'
    writeFileSync(join(dir, '.gitignore'), mine)
    await service.openRepo(dir)

    const result = await service.init()

    expect(result.wroteGitignore).toBe(false)
    expect(readFileSync(join(dir, '.gitignore'), 'utf-8')).toBe(mine)
    expect(result.summary).not.toContain('.gitignore')
    // The user's own rules are in force, and ours are not.
    expect(isIgnored(dir, 'secrets.env')).toBe(true)
    expect(isIgnored(dir, '.DS_Store')).toBe(false)
  })

  it('refuses to initialise a folder that is already a repository', async () => {
    await service.openRepo(dir)
    await service.init()

    // A stale panel could still offer the button; the second call must say why.
    await expect(service.init()).rejects.toThrow(/already a Git repository/i)
  })

  it('refuses to nest a repository inside an existing one, naming the outer repo', async () => {
    await service.openRepo(dir)
    await service.init()

    const sub = join(dir, 'firmware')
    mkdirSync(sub)
    writeFileSync(join(sub, 'boot.py'), 'pass\n')
    const inner = new GitService()
    await inner.openRepo(sub)

    await expect(inner.init()).rejects.toThrow(new RegExp(`already inside the Git repository at ${dir}`))
    // Nothing was created: the subfolder is still just a folder.
    expect(git(sub, ['rev-parse', '--show-toplevel'])).toBe(dir)
  })

  it('refuses when no folder is open', async () => {
    await expect(new GitService().init()).rejects.toThrow(/no folder is open/i)
  })

  it('leaves the service pointed at the new repo, so a refresh shows it', async () => {
    await service.openRepo(dir)
    await service.init()
    // No second openRepo: the panel calls refresh() -> status() straight after.
    const status = await service.status()
    expect(status.isRepo).toBe(true)
    expect(status.root).toBe(dir)
  })

  it('reports hasCommits once the user makes the first commit', async () => {
    await service.openRepo(dir)
    await service.init()
    git(dir, ['config', 'user.email', 'test@example.com'])
    git(dir, ['config', 'user.name', 'Test'])

    await service.commit('first commit')

    const status = await service.status()
    expect(status.hasCommits).toBe(true)
    expect(status.untracked).toHaveLength(0)
    // The ignored clutter stayed out of the history it just created.
    const tracked = git(dir, ['ls-files']).split('\n')
    expect(tracked).toContain('meshes/wheel.stl')
    expect(tracked).toContain('.gitignore')
    expect(tracked.some((p) => p.includes('__pycache__'))).toBe(false)
  })
})
