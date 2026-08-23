/**
 * Pure helpers behind the Source Control panel's "Publish to GitHub" button (#795).
 *
 * Lives in `shared/` for the same reason `git-stage.ts` does: BOTH sides need
 * the same answers. The renderer validates the name as it is typed and warns
 * about what a public repo would expose; the main process builds the actual
 * `gh` argv and guards the call. If those two disagreed, the dialog would
 * accept a name that `gh` then rejects — or, far worse, promise "private" and
 * pass a flag that means something else.
 *
 * Deliberately free of `child_process`, `fs` and Electron so it is directly
 * unit-testable (the shape `main/git/init-support.ts` established for #783).
 */

/**
 * Who can see the new repository.
 *
 * `internal` is deliberately NOT offered: it only exists inside a GitHub
 * Enterprise organisation, and an option that errors for almost every user of
 * this app is worse than no option at all.
 */
export type GitVisibility = 'private' | 'public'

/**
 * The default a fresh dialog opens on — **private**.
 *
 * This is a safety default, not a neutral one. Snakie's users are people
 * writing robot code on microcontrollers, and the MicroPython idiom for Wi-Fi
 * credentials is a plain `secrets.py` sitting next to `main.py`. Publishing is
 * one click and effectively irreversible — a public commit is scraped, forked
 * and cached within minutes, so "delete the repo" does not un-publish a
 * password. Making the user opt IN to public costs one click; making them opt
 * out costs them their network.
 */
export const DEFAULT_VISIBILITY: GitVisibility = 'private'

/** GitHub's own cap on a repository name. */
export const MAX_REPO_NAME = 100

/** GitHub's cap on an owner (user or organisation) login. */
export const MAX_OWNER = 39

/** What the user typed, split into its optional owner and its repository name. */
export interface OwnerAndName {
  /** The `org/` part, when one was typed. Undefined means "my own account". */
  owner?: string
  /** The repository name itself. */
  name: string
}

/**
 * Split `OWNER/NAME` into its parts. A bare name has no owner, which `gh`
 * reads as "the authenticated user" — the same rule its own CLI documents.
 */
export function splitOwnerAndName(input: string): OwnerAndName {
  const trimmed = input.trim()
  const slash = trimmed.indexOf('/')
  if (slash < 0) return { name: trimmed }
  return { owner: trimmed.slice(0, slash).trim(), name: trimmed.slice(slash + 1).trim() }
}

/**
 * Turn a folder name into a plausible repository name.
 *
 * GitHub accepts only letters, digits, `.`, `-` and `_`; a folder called
 * "Line Follower (v2)" is a perfectly ordinary thing to have on disk and a
 * name GitHub will reject. Rather than fail on submit, offer the sanitised
 * form up front so the dialog opens on something that already works.
 *
 * Case is preserved — GitHub preserves it too, and silently lower-casing
 * someone's "PicoRover" would be a small unasked-for edit to their project's
 * identity.
 */
export function suggestRepoName(folderName: string): string {
  const cleaned = (folderName ?? '')
    .trim()
    // Every run of unsupported characters becomes ONE hyphen, so "Line
    // Follower (v2)" reads as "Line-Follower-v2" rather than a hyphen thicket.
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    // Leading/trailing punctuation is legal but looks like a mistake, and a
    // name of only dots is rejected outright.
    .replace(/^[-._]+/, '')
    .replace(/[-._]+$/, '')
    .slice(0, MAX_REPO_NAME)
  return cleaned
}

/** The outcome of checking a typed name, ready to render beside the input. */
export interface NameCheck {
  /** True when `gh` would accept this name. */
  ok: boolean
  /** Why not, as a sentence — present only when `ok` is false. */
  error?: string
}

/**
 * Validate what the user typed, owner prefix included.
 *
 * Checked HERE rather than left to `gh` because a rejection that arrives after
 * the click has already created nothing, said "HTTP 422", and lost the user's
 * description is a much worse experience than a line of red under the field.
 */
export function validateRepoName(input: string): NameCheck {
  const raw = (input ?? '').trim()
  if (!raw) return { ok: false, error: 'Give the repository a name.' }

  const { owner, name } = splitOwnerAndName(raw)

  if (raw.split('/').length > 2) {
    return {
      ok: false,
      error: 'Use either "name" or "owner/name" — a repository name cannot contain a slash.'
    }
  }

  if (owner !== undefined) {
    if (!owner) return { ok: false, error: 'Type an owner before the slash, or drop the slash.' }
    if (owner.length > MAX_OWNER) {
      return { ok: false, error: `An owner name can be at most ${MAX_OWNER} characters.` }
    }
    if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(owner)) {
      return {
        ok: false,
        error: 'An owner is letters, digits and hyphens, and cannot start or end with a hyphen.'
      }
    }
  }

  if (!name) return { ok: false, error: 'Give the repository a name after the slash.' }
  if (name.length > MAX_REPO_NAME) {
    return { ok: false, error: `A repository name can be at most ${MAX_REPO_NAME} characters.` }
  }
  if (name === '.' || name === '..') {
    return { ok: false, error: 'GitHub does not allow "." or ".." as a repository name.' }
  }
  if (!/^[A-Za-z0-9._-]+$/.test(name)) {
    return {
      ok: false,
      error: 'Use letters, digits, dots, hyphens and underscores only — no spaces.'
    }
  }
  return { ok: true }
}

/** Everything `gh repo create` needs, already validated. */
export interface PublishInput {
  /** `NAME` or `OWNER/NAME`, exactly as the dialog resolved it. */
  name: string
  /** Optional one-line description. Empty means "send no description". */
  description?: string
  /** Who can see it. */
  visibility: GitVisibility
  /** Absolute path of the local repository to publish. */
  source: string
  /** Remote name to create. `origin` unless something already owns it. */
  remote?: string
}

/**
 * The exact `gh` argv for a publish — no shell, one array element per argument.
 *
 * Built here, and unit-tested, for two reasons. The visibility flag is the
 * whole promise of the dialog's radio button, so it is worth an assertion that
 * `private` produces `--private` and nothing else. And keeping this as an argv
 * (never a command string) is what makes a repository named `foo; rm -rf ~`
 * merely an invalid name rather than an executed one.
 */
export function publishArgs(input: PublishInput): string[] {
  const args = [
    'repo',
    'create',
    input.name.trim(),
    '--source',
    input.source,
    '--remote',
    input.remote?.trim() || 'origin',
    '--push',
    input.visibility === 'public' ? '--public' : '--private'
  ]
  const description = (input.description ?? '').trim()
  if (description) args.push('--description', description)
  return args
}

/**
 * File names that would be a bad thing to make public, checked against the
 * files git is ALREADY TRACKING (an untracked file is never pushed).
 *
 * The list is short and high-signal on purpose. A scanner that cried wolf over
 * every `config.py` would train people to click through the warning, which is
 * the one outcome that makes this worse than having no warning at all.
 * `secrets.py` leads the list because it is not a guess — it is the documented
 * MicroPython convention for Wi-Fi credentials, so on this app's projects it is
 * very often a real password.
 */
const RISKY_BASENAMES = new Set([
  'secrets.py',
  'secrets.json',
  'secrets.yml',
  'secrets.yaml',
  'credentials.py',
  'credentials.json',
  'id_rsa',
  'id_ecdsa',
  'id_ed25519',
  '.netrc',
  '.npmrc'
])

/** Extensions that are private keys or key stores almost by definition. */
const RISKY_EXTENSIONS = ['.pem', '.key', '.p12', '.pfx', '.keystore']

/**
 * The tracked paths worth a second look before going public.
 *
 * Takes repo-relative paths (`git ls-files`) and returns the subset that names
 * a well-known credential file. Pure string work — it never opens a file, so it
 * cannot itself become a way to leak one.
 */
export function secretRisks(paths: readonly string[]): string[] {
  const hits: string[] = []
  for (const path of paths) {
    if (!path) continue
    const base = (path.split('/').pop() ?? path).toLowerCase()
    const risky =
      RISKY_BASENAMES.has(base) ||
      base === '.env' ||
      base.startsWith('.env.') ||
      RISKY_EXTENSIONS.some((ext) => base.endsWith(ext))
    if (risky) hits.push(path)
  }
  return hits
}

/** English pluralisation for the small counts this feature deals in. */
function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many
}

/**
 * The sentence shown when a public publish would include credential-shaped
 * files. It names them, because "1 risky file" is not something anyone can act
 * on, and it stops short of blocking: the user may well have a `.pem` that is a
 * public certificate, and Snakie does not get to overrule them about their own
 * files.
 */
export function secretWarning(paths: readonly string[]): string | undefined {
  if (paths.length === 0) return undefined
  const shown = paths.slice(0, 4).join(', ')
  const rest = paths.length > 4 ? `, and ${paths.length - 4} more` : ''
  return (
    `This repository tracks ${paths.length} ${plural(paths.length, 'file', 'files')} that usually ` +
    `${plural(paths.length, 'holds', 'hold')} secrets: ${shown}${rest}. ` +
    'A public repository is scraped and cached within minutes, so anything committed here ' +
    'should be treated as leaked even if you delete it afterwards. Publish privately, or ' +
    'remove them from the repository first.'
  )
}

/** The shape {@link publishSummary} needs; a subset of `GitPublishResult`. */
export interface PublishSummaryInput {
  /** `owner/name` as GitHub created it. */
  fullName: string
  visibility: GitVisibility
  /** Branch that was pushed, when one was. */
  branch?: string
  /** Remote name that now points at GitHub. */
  remote: string
}

/**
 * The one-line report shown after a successful publish. It names the repo, says
 * plainly whether it is public, and names the branch that was pushed — the
 * three things a user needs to confirm the click did what the dialog promised.
 */
export function publishSummary(input: PublishSummaryInput): string {
  const where = input.visibility === 'public' ? 'public' : 'private'
  const branch = input.branch ? `, pushed ${input.branch}` : ''
  return `Published ${input.fullName} as a ${where} repository${branch} (remote "${input.remote}").`
}

/**
 * Turn a raw `gh` failure into a sentence the user can act on.
 *
 * The two cases that matter both look like a Snakie bug when passed through
 * raw: a missing binary surfaces as `spawn gh ENOENT`, and an unauthenticated
 * CLI as a wall of usage text. Everything else is passed through, because a
 * real GitHub error ("Name already exists on this account") is far more useful
 * than a paraphrase of it. Mirrors `gitFailureText` in `init-support.ts`.
 */
export function ghFailureText(err: unknown): string {
  const text = (err instanceof Error ? err.message : String(err)).trim()

  const missing =
    /spawn\s+gh\b.*ENOENT/i.test(text) ||
    /ENOENT.*\bgh\b/i.test(text) ||
    /'gh' is not recognized/i.test(text) ||
    /gh: command not found/i.test(text)
  if (missing) {
    return (
      'The GitHub CLI (gh) is not installed on this computer (or is not on its PATH). ' +
      'Snakie publishes through gh so it never has to ask for your GitHub password — ' +
      'install it from https://cli.github.com, then restart Snakie and try again.'
    )
  }

  const unauthenticated =
    /not logged in(to| to)? any GitHub hosts/i.test(text) ||
    /gh auth login/i.test(text) ||
    /authentication token not found/i.test(text) ||
    /requires authentication/i.test(text)
  if (unauthenticated) {
    return (
      'The GitHub CLI is not signed in to GitHub. Open a terminal, run `gh auth login`, ' +
      'follow the prompts, then come back and try again. (Snakie cannot run that sign-in ' +
      'for you — it is interactive on purpose, so your credentials only ever go to GitHub.)'
    )
  }

  if (/name already exists on this account/i.test(text)) {
    return (
      'You already have a repository with that name on GitHub. ' +
      'Pick a different name, or delete the existing repository first.'
    )
  }

  return text
}
