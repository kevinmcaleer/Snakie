/**
 * Pure helpers behind "Initialise Repository" (issue #783).
 *
 * Kept free of `simple-git`, `fs` and Electron so they can be unit-tested
 * directly: the starter `.gitignore` Snakie writes into a brand-new repo, the
 * translation of a raw git/spawn failure into something a person can act on,
 * and the one-line report the panel shows afterwards.
 */

/**
 * The `.gitignore` Snakie writes when it creates a repository, and only then —
 * an existing `.gitignore` is never touched.
 *
 * The list is deliberately SHORT. Everything in here is machine-generated on
 * this computer and reproducible; everything that is actually the project —
 * `.py` sources, `robot.yml`, `.urdf` models and the `meshes/` folder those
 * models point at, vendored `.py`/`.mpy` drivers — is left tracked. A first
 * commit that quietly omits the meshes a URDF needs is a far worse outcome than
 * one that includes a stray `.pyc`, so the bias is towards committing too much
 * rather than too little.
 */
export const SNAKIE_GITIGNORE = `# .gitignore — written by Snakie when this folder became a Git repository.
#
# Only machine-generated clutter is listed here. Everything that IS the
# project — your .py files, robot.yml, .urdf models and the meshes/ folder
# they point at — stays tracked, because losing those is exactly what
# version control is meant to prevent. Edit this file freely.

# Desktop clutter
.DS_Store
Thumbs.db
desktop.ini

# Python bytecode, from running scripts on this computer
__pycache__/
*.pyc

# Snakie's rescue copy of a robot.yml it could not parse
*.bak

# Editor scratch files
*~
*.swp
`

/**
 * Turn a raw git/spawn failure into a sentence the user can act on.
 *
 * The case that matters is "git is not installed": Node surfaces that as a bare
 * `spawn git ENOENT`, which explains nothing and looks like a Snakie bug.
 * Anything else is passed through unchanged — a real git message is usually
 * more useful than a paraphrase of it.
 */
export function gitFailureText(err: unknown): string {
  const text = (err instanceof Error ? err.message : String(err)).trim()
  const missing =
    /spawn\s+git\b.*ENOENT/i.test(text) ||
    /ENOENT.*\bgit\b/i.test(text) ||
    /'git' is not recognized/i.test(text) ||
    /git: command not found/i.test(text)
  if (missing) {
    return (
      'Git is not installed on this computer (or is not on its PATH). ' +
      'Snakie uses the system git — install it from https://git-scm.com/downloads, ' +
      'then restart Snakie and try again.'
    )
  }
  return text
}

/** The shape {@link initSummary} needs; a subset of `GitInitResult`. */
export interface InitSummaryInput {
  branch?: string
  wroteGitignore: boolean
  untrackedCount: number
}

/**
 * The one-line report shown after a successful init. It names the branch, says
 * whether a `.gitignore` was written, and says how many files are now waiting —
 * so the user can tell at a glance that nothing was committed on their behalf.
 */
export function initSummary(input: InitSummaryInput): string {
  const branch = input.branch ? `Created an empty repository on ${input.branch}` : 'Created an empty repository'
  const ignore = input.wroteGitignore ? ', added a .gitignore' : ''
  const n = input.untrackedCount
  const files = n === 0 ? 'nothing to commit yet' : `${n} file${n === 1 ? '' : 's'} ready for a first commit`
  return `${branch}${ignore} — ${files}. Nothing has been committed.`
}
