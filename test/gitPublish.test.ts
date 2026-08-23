import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { GitService } from '../src/main/git/GitService'
import {
  DEFAULT_VISIBILITY,
  ghFailureText,
  publishArgs,
  publishSummary,
  secretRisks,
  secretWarning,
  splitOwnerAndName,
  suggestRepoName,
  validateRepoName
} from '../src/shared/git-publish'

/**
 * #795 — "Publish to GitHub" in the Source Control pane.
 *
 * The button creates a repository on someone's real GitHub account and pushes
 * their code to it, so the promises worth pinning down are the ones that would
 * be expensive to get wrong:
 *
 *  - **The visibility flag means what the radio button said.** `private` must
 *    produce `--private` and nothing else — an inverted flag here publishes
 *    someone's Wi-Fi password to the internet.
 *  - **A name is never interpolated into a shell.** Everything is an argv, so a
 *    repository called `foo; rm -rf ~` is an invalid name, not a command.
 *  - **The secrets warning fires on the files that matter and stays quiet
 *    otherwise** — a warning that cries wolf is one people click through.
 *  - **Publishing refuses the states that would leave a mess**: no commits (an
 *    empty repo on GitHub), an existing remote (a second home for the same
 *    project), an invalid name.
 *  - The failure modes (no `gh`, signed out, name taken) come back as sentences.
 *
 * The repository half runs the REAL {@link GitService} against real temp folders
 * and the real `git` binary — the same seam `gitInit.test.ts` (#783) and
 * `gitStageAll.test.ts` (#794) use. Nothing here ever calls `gh`: every test
 * that would reach the network stops at a guard that fires first, which is
 * precisely the behaviour being asserted.
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
  return execFileSync('git', args, {
    cwd: dir,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'ignore']
  }).trim()
}

const roots: string[] = []

/** A committed repository, the normal starting point for a publish. */
function committedRepo(): string {
  // realpath: macOS temp dirs are symlinks (/var → /private/var) and git always
  // reports the resolved path, so compare like with like.
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'snakie-795-')))
  roots.push(dir)
  writeFileSync(join(dir, 'main.py'), 'print("hello")\n')
  git(dir, ['init'])
  git(dir, ['config', 'user.email', 'test@example.com'])
  git(dir, ['config', 'user.name', 'Test'])
  git(dir, ['add', 'main.py'])
  git(dir, ['commit', '-m', 'initial'])
  return dir
}

afterAll(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe('suggestRepoName', () => {
  it('turns an ordinary folder name into one GitHub will accept', () => {
    expect(suggestRepoName('Line Follower (v2)')).toBe('Line-Follower-v2')
    expect(suggestRepoName('my robot!!')).toBe('my-robot')
  })

  it('preserves case, rather than quietly renaming the user’s project', () => {
    expect(suggestRepoName('PicoRover')).toBe('PicoRover')
  })

  it('keeps the characters GitHub allows', () => {
    expect(suggestRepoName('pico-rover_v2.1')).toBe('pico-rover_v2.1')
  })

  it('trims punctuation that would look like a mistake', () => {
    expect(suggestRepoName('--rover--')).toBe('rover')
    expect(suggestRepoName('.hidden')).toBe('hidden')
  })

  it('collapses a run of bad characters into ONE hyphen', () => {
    expect(suggestRepoName('a   b')).toBe('a-b')
    expect(suggestRepoName('a @#$ b')).toBe('a-b')
  })

  it('survives a folder name with nothing usable in it', () => {
    expect(suggestRepoName('!!!')).toBe('')
    expect(suggestRepoName('')).toBe('')
  })

  it('never exceeds GitHub’s length cap', () => {
    expect(suggestRepoName('x'.repeat(200))).toHaveLength(100)
  })
})

describe('splitOwnerAndName', () => {
  it('reads a bare name as "my own account"', () => {
    expect(splitOwnerAndName('rover')).toEqual({ name: 'rover' })
  })

  it('splits an owner prefix', () => {
    expect(splitOwnerAndName('kevsrobots/rover')).toEqual({
      owner: 'kevsrobots',
      name: 'rover'
    })
  })
})

describe('validateRepoName', () => {
  it('accepts the names GitHub accepts', () => {
    for (const name of ['rover', 'pico-rover', 'pico_rover', 'rover.v2', 'org/rover']) {
      expect(validateRepoName(name).ok, name).toBe(true)
    }
  })

  it('rejects an empty name with something the user can act on', () => {
    const check = validateRepoName('   ')
    expect(check.ok).toBe(false)
    expect(check.error).toMatch(/name/i)
  })

  it('rejects a space, which is the mistake people actually make', () => {
    const check = validateRepoName('my robot')
    expect(check.ok).toBe(false)
    expect(check.error).toMatch(/no spaces/i)
  })

  it('rejects shell metacharacters as an invalid NAME (they never reach a shell)', () => {
    expect(validateRepoName('foo; rm -rf ~').ok).toBe(false)
    expect(validateRepoName('foo$(whoami)').ok).toBe(false)
    expect(validateRepoName('foo`id`').ok).toBe(false)
  })

  it('rejects a second slash rather than guessing which half is the owner', () => {
    const check = validateRepoName('a/b/c')
    expect(check.ok).toBe(false)
    expect(check.error).toMatch(/owner\/name/i)
  })

  it('rejects the names GitHub reserves', () => {
    expect(validateRepoName('.').ok).toBe(false)
    expect(validateRepoName('..').ok).toBe(false)
  })

  it('enforces the length caps', () => {
    expect(validateRepoName('x'.repeat(100)).ok).toBe(true)
    expect(validateRepoName('x'.repeat(101)).ok).toBe(false)
    expect(validateRepoName(`${'o'.repeat(40)}/rover`).ok).toBe(false)
  })

  it('rejects an owner that starts or ends with a hyphen, as GitHub does', () => {
    expect(validateRepoName('-org/rover').ok).toBe(false)
    expect(validateRepoName('org-/rover').ok).toBe(false)
    expect(validateRepoName('o-rg/rover').ok).toBe(true)
  })

  it('rejects a bare slash and an empty half', () => {
    expect(validateRepoName('/rover').ok).toBe(false)
    expect(validateRepoName('org/').ok).toBe(false)
  })
})

describe('publishArgs', () => {
  const base = { name: 'rover', source: '/tmp/rover', visibility: 'private' as const }

  it('sends --private for a private repository, and never --public', () => {
    const args = publishArgs(base)
    expect(args).toContain('--private')
    expect(args).not.toContain('--public')
  })

  it('sends --public only when public was actually chosen', () => {
    const args = publishArgs({ ...base, visibility: 'public' })
    expect(args).toContain('--public')
    expect(args).not.toContain('--private')
  })

  it('defaults to private for anything that is not the literal "public"', () => {
    // The dialog is typed, but this value crosses IPC — a missing or mangled
    // field must fail CLOSED, towards the repository nobody can read.
    const args = publishArgs({ ...base, visibility: 'PUBLIC' as never })
    expect(args).toContain('--private')
  })

  it('matches the default the dialog opens on', () => {
    expect(DEFAULT_VISIBILITY).toBe('private')
    expect(publishArgs({ ...base, visibility: DEFAULT_VISIBILITY })).toContain('--private')
  })

  it('publishes from the given source and pushes', () => {
    const args = publishArgs(base)
    expect(args.slice(0, 3)).toEqual(['repo', 'create', 'rover'])
    expect(args[args.indexOf('--source') + 1]).toBe('/tmp/rover')
    expect(args).toContain('--push')
    expect(args[args.indexOf('--remote') + 1]).toBe('origin')
  })

  it('omits --description entirely when there is none, rather than sending ""', () => {
    expect(publishArgs(base)).not.toContain('--description')
    expect(publishArgs({ ...base, description: '   ' })).not.toContain('--description')
  })

  it('passes a description as its OWN argv element, so quoting is impossible', () => {
    const args = publishArgs({ ...base, description: 'A robot; rm -rf ~' })
    expect(args[args.indexOf('--description') + 1]).toBe('A robot; rm -rf ~')
  })

  it('keeps every argument separate, so nothing can be read as a command', () => {
    const args = publishArgs({
      ...base,
      name: 'rover',
      source: '/tmp/a folder with spaces',
      description: '$(whoami)'
    })
    // No element is a joined command line, and the awkward values survive whole.
    expect(args).toContain('/tmp/a folder with spaces')
    expect(args).toContain('$(whoami)')
    for (const arg of args) expect(arg).not.toMatch(/\s--\w/)
  })
})

describe('secretRisks', () => {
  it('flags the MicroPython credentials file by name', () => {
    expect(secretRisks(['main.py', 'secrets.py'])).toEqual(['secrets.py'])
  })

  it('flags it in a subfolder too, and reports the full path', () => {
    expect(secretRisks(['lib/secrets.py'])).toEqual(['lib/secrets.py'])
  })

  it('flags dotenv files, including the suffixed variants', () => {
    expect(secretRisks(['.env', '.env.local', '.environment'])).toEqual(['.env', '.env.local'])
  })

  it('flags private keys and key stores by extension', () => {
    expect(secretRisks(['server.pem', 'wifi.key', 'store.p12'])).toHaveLength(3)
  })

  it('is case-insensitive, because Windows and macOS are', () => {
    expect(secretRisks(['Secrets.PY'])).toEqual(['Secrets.PY'])
  })

  it('stays quiet about ordinary project files', () => {
    expect(
      secretRisks(['main.py', 'robot.yml', 'arm.urdf', 'meshes/wheel.stl', 'config.py', 'README.md'])
    ).toEqual([])
  })

  it('does not flag a file merely because "secret" appears in its name', () => {
    // Cry-wolf guard: the list is exact basenames, not a substring search.
    expect(secretRisks(['secret_santa.py', 'no-secrets-here.md'])).toEqual([])
  })
})

describe('secretWarning', () => {
  it('says nothing when there is nothing to say', () => {
    expect(secretWarning([])).toBeUndefined()
  })

  it('names the files, because a count is not actionable', () => {
    const warning = secretWarning(['secrets.py'])
    expect(warning).toContain('secrets.py')
  })

  it('explains that deleting afterwards does not un-publish', () => {
    expect(secretWarning(['secrets.py'])).toMatch(/leaked|cached|scraped/i)
  })

  it('summarises a long list rather than printing all of it', () => {
    const warning = secretWarning(['a.pem', 'b.pem', 'c.pem', 'd.pem', 'e.pem', 'f.pem']) ?? ''
    expect(warning).toContain('and 2 more')
  })
})

describe('publishSummary', () => {
  it('states the visibility in words, so the outcome can be checked', () => {
    expect(
      publishSummary({ fullName: 'kev/rover', visibility: 'public', branch: 'main', remote: 'origin' })
    ).toContain('public')
    expect(
      publishSummary({ fullName: 'kev/rover', visibility: 'private', branch: 'main', remote: 'origin' })
    ).toContain('private')
  })

  it('names the repository and the branch it pushed', () => {
    const summary = publishSummary({
      fullName: 'kev/rover',
      visibility: 'private',
      branch: 'main',
      remote: 'origin'
    })
    expect(summary).toContain('kev/rover')
    expect(summary).toContain('main')
  })
})

describe('ghFailureText', () => {
  it('turns a missing gh binary into an actionable sentence with the install link', () => {
    const text = ghFailureText(new Error('spawn gh ENOENT'))
    expect(text).toMatch(/GitHub CLI/i)
    expect(text).toContain('https://cli.github.com')
  })

  it('recognises the Windows shell wording for a missing gh', () => {
    expect(ghFailureText("'gh' is not recognized as an internal or external command")).toMatch(
      /not installed/i
    )
  })

  it('turns a signed-out CLI into the exact command to run', () => {
    const text = ghFailureText('You are not logged into any GitHub hosts. Run gh auth login')
    expect(text).toContain('gh auth login')
  })

  it('explains that Snakie cannot do the sign-in for you', () => {
    expect(ghFailureText('gh auth login')).toMatch(/interactive/i)
  })

  it('turns a taken name into advice rather than an HTTP code', () => {
    const text = ghFailureText('GraphQL: Name already exists on this account (createRepository)')
    expect(text).toMatch(/already have a repository with that name/i)
  })

  it('passes a real GitHub message through rather than paraphrasing it', () => {
    expect(ghFailureText('HTTP 403: Resource not accessible by integration')).toContain('HTTP 403')
  })

  it('handles a non-Error rejection without losing the text', () => {
    expect(ghFailureText('something odd happened')).toBe('something odd happened')
  })
})

// ---------------------------------------------------------------------------
// IPC wiring
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

    const preload = readFileSync(join(__dirname, '..', 'src', 'preload', 'index.ts'), 'utf-8')
    const invoked = [...preload.matchAll(/ipcRenderer\.invoke\(\s*'(git:[^']+)'/g)].map((m) => m[1])

    // Called out by name so a regression reads as "the publish button is dead"
    // rather than as a count mismatch.
    expect(invoked).toContain('git:publish')
    expect(invoked).toContain('git:publishPreflight')
    expect(handlers).toContain('git:publish')
    expect(handlers).toContain('git:publishPreflight')
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

describe.skipIf(!haveGit())('GitService.publish guards, against a real git', () => {
  let service: GitService

  beforeEach(() => {
    service = new GitService()
  })

  it('reports remotes in status, which is what decides the button', async () => {
    const dir = committedRepo()
    await service.openRepo(dir)
    expect((await service.status()).remotes).toEqual([])

    git(dir, ['remote', 'add', 'origin', 'https://example.com/x.git'])
    expect((await service.status()).remotes).toEqual(['origin'])
  })

  it('refuses an invalid name before it can reach the network', async () => {
    const dir = committedRepo()
    await service.openRepo(dir)
    await expect(
      service.publish({ name: 'my robot', visibility: 'private' })
    ).rejects.toThrow(/no spaces/i)
  })

  it('refuses to publish a repository that has no commits', async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'snakie-795-empty-')))
    roots.push(dir)
    writeFileSync(join(dir, 'main.py'), 'print(1)\n')
    git(dir, ['init'])
    await service.openRepo(dir)

    await expect(service.publish({ name: 'rover', visibility: 'private' })).rejects.toThrow(
      /no commits yet/i
    )
  })

  it('refuses to publish a repository that already has a remote, and names it', async () => {
    const dir = committedRepo()
    git(dir, ['remote', 'add', 'origin', 'https://example.com/x.git'])
    await service.openRepo(dir)

    await expect(service.publish({ name: 'rover', visibility: 'private' })).rejects.toThrow(
      /already has a remote \("origin"\)/i
    )
  })

  it('refuses when the folder is not a repository at all', async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'snakie-795-plain-')))
    roots.push(dir)
    await service.openRepo(dir)

    await expect(service.publish({ name: 'rover', visibility: 'private' })).rejects.toThrow(
      /not a Git repository/i
    )
  })
})

describe.skipIf(!haveGit())('GitService.publishPreflight, against a real git', () => {
  let service: GitService

  beforeEach(() => {
    service = new GitService()
  })

  it('suggests a name derived from the repository folder', async () => {
    const dir = committedRepo()
    await service.openRepo(dir)
    const pre = await service.publishPreflight()
    // The temp folder is `snakie-795-XXXXXX`, already a legal repo name.
    expect(pre.suggestedName).toMatch(/^snakie-795-/)
  })

  it('blocks a repository with no commits, in words', async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'snakie-795-pre-empty-')))
    roots.push(dir)
    git(dir, ['init'])
    await service.openRepo(dir)

    const pre = await service.publishPreflight()
    expect(pre.hasCommits).toBe(false)
    expect(pre.blockers.join(' ')).toMatch(/no commits yet/i)
  })

  it('blocks a repository that already has a remote, and names it', async () => {
    const dir = committedRepo()
    git(dir, ['remote', 'add', 'origin', 'https://example.com/x.git'])
    await service.openRepo(dir)

    const pre = await service.publishPreflight()
    expect(pre.existingRemote).toBe('origin')
    expect(pre.blockers.join(' ')).toMatch(/already has a remote/i)
  })

  it('finds tracked secrets, and ignores untracked and ignored ones', async () => {
    const dir = committedRepo()
    // Tracked — this one WOULD be pushed.
    writeFileSync(join(dir, 'secrets.py'), 'WIFI_PASSWORD = "hunter2"\n')
    git(dir, ['add', 'secrets.py'])
    git(dir, ['commit', '-m', 'add secrets'])
    // Untracked, and ignored — neither is ever pushed, so neither should warn.
    writeFileSync(join(dir, '.env'), 'TOKEN=abc\n')
    mkdirSync(join(dir, 'lib'), { recursive: true })
    writeFileSync(join(dir, 'lib', 'credentials.py'), 'X = 1\n')
    writeFileSync(join(dir, '.gitignore'), 'lib/credentials.py\n')

    await service.openRepo(dir)
    const pre = await service.publishPreflight()

    expect(pre.riskyPaths).toContain('secrets.py')
    expect(pre.riskyPaths).not.toContain('.env')
    expect(pre.riskyPaths).not.toContain('lib/credentials.py')
  })

  it('reports a clean project as having nothing to warn about', async () => {
    const dir = committedRepo()
    await service.openRepo(dir)
    expect((await service.publishPreflight()).riskyPaths).toEqual([])
  })
})
