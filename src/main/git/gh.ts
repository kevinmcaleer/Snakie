import { execFile } from 'child_process'
import { promisify } from 'util'
import { ghFailureText } from '../../shared/git-publish'

const run = promisify(execFile)

/**
 * A very small wrapper around the GitHub CLI, for "Publish to GitHub" (#795).
 *
 * Separate from {@link GitService} because `gh` is a different binary with
 * different failure modes: `simple-git` speaks to a repository, this speaks to
 * a network service that can be down, rate-limited, or simply not signed in.
 *
 * **`gh` rather than the GitHub API on purpose.** Creating a repository needs a
 * credential, and the alternatives all end with Snakie holding one: a personal
 * access token typed into a Snakie field and stored by Snakie, or an OAuth flow
 * Snakie would have to implement and keep secret. `gh` already holds the user's
 * token in the OS keychain, already handles refresh and two-factor, and is
 * already the thing they use from a terminal. Snakie never sees the credential,
 * and there is nothing here to leak.
 *
 * Every call is `execFile` with an ARGV — never a shell string — so a
 * repository name, description or path containing shell metacharacters is
 * data, not code.
 */

/** How long a metadata call may take before we stop waiting. */
const QUICK_TIMEOUT_MS = 15_000

/**
 * How long a publish may take. Generous because `--push` uploads the whole
 * history, and a first push of a repo full of `meshes/` on a slow connection is
 * legitimately slow — timing that out and leaving a created-but-unpushed repo
 * behind is a worse failure than waiting.
 */
const PUBLISH_TIMEOUT_MS = 300_000

/** Combined output of a `gh` invocation. */
export interface GhOutput {
  stdout: string
  stderr: string
}

/**
 * Run `gh` with `args`, rejecting with a readable message on failure.
 *
 * `gh` writes most of its progress to stderr even on success, so both streams
 * come back and the CALLER decides what is interesting. On failure the two are
 * joined before being handed to {@link ghFailureText}, because the sentence
 * worth showing ("Name already exists on this account") is usually on stderr
 * while Node's own `Error.message` only carries the exit code.
 */
export async function runGh(
  args: readonly string[],
  options: { cwd?: string; timeout?: number } = {}
): Promise<GhOutput> {
  try {
    const { stdout, stderr } = await run('gh', [...args], {
      cwd: options.cwd,
      timeout: options.timeout ?? QUICK_TIMEOUT_MS,
      // gh's own output is small; this only guards against a pathological case.
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true
    })
    return { stdout: String(stdout), stderr: String(stderr) }
  } catch (err) {
    const detail = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string }
    const combined = [detail.stderr, detail.stdout, detail.message]
      .map((part) => (part ?? '').toString().trim())
      .filter(Boolean)
      .join('\n')
    throw new Error(ghFailureText(combined || String(err)))
  }
}

/** The timeout a publish should be given. Exported so the service reads one number. */
export const publishTimeout = PUBLISH_TIMEOUT_MS

/**
 * The `gh` version string, or undefined when no `gh` is on PATH.
 *
 * Never throws: "not installed" is a state the dialog renders, not an error it
 * reports. `gh --version` prints `gh version 2.89.0 (…)` plus a release URL, so
 * only the first line is kept.
 */
export async function ghVersion(): Promise<string | undefined> {
  try {
    const { stdout } = await runGh(['--version'])
    const first = stdout.split(/\r?\n/)[0]?.trim()
    return first || undefined
  } catch {
    return undefined
  }
}

/**
 * The signed-in GitHub login, or undefined when `gh` is not authenticated.
 *
 * Read from `gh auth status`, whose exit code is the authority (0 signed in,
 * non-zero not). The login itself is scraped from the "Logged in to github.com
 * account <login>" line — best-effort, because the dialog uses it only to SHOW
 * the user where their repository will land. A version of `gh` that words that
 * line differently costs a nicety, not the feature: `authenticated` still
 * follows the exit code.
 */
export async function ghAccount(): Promise<string | undefined> {
  const { stdout, stderr } = await runGh(['auth', 'status'])
  // The line has lived on both streams across gh versions; search both.
  const text = `${stdout}\n${stderr}`
  const match =
    /Logged in to \S+ (?:as|account) ([A-Za-z0-9-]+)/i.exec(text) ??
    /account ([A-Za-z0-9-]+)/i.exec(text)
  return match?.[1]
}
