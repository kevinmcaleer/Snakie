#!/usr/bin/env node
/**
 * CHANGELOG FRAGMENTS — ONE FILE PER CHANGE (#1254).
 * =============================================================================
 *
 * Every branch used to append to `CHANGELOG.md` in the same place, so nearly
 * every pull request conflicted there. `.gitattributes` marks the file
 * `merge=union`, which fixes the merge *locally* — but GitHub's server-side
 * merge ignores `.gitattributes` merge drivers, so the web UI kept reporting a
 * conflict and the merge button stayed dead.
 *
 * The cure is not a cleverer merge, it is not sharing the file: a change drops
 * a NEW file in `changelog.d/`, and `CHANGELOG.md` is only written when a
 * release is cut. Distinct new files never conflict.
 *
 *     node scripts/changelog.mjs new added "Short title" --issue 1246
 *     node scripts/changelog.mjs preview
 *     node scripts/changelog.mjs check [--base origin/master]
 *     node scripts/changelog.mjs release 0.86.0 [--date 2026-09-21]
 *
 * See `changelog.d/README.md`.
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const DIR = 'changelog.d'
const CHANGELOG = 'CHANGELOG.md'
const REPO = 'https://github.com/kevinmcaleer/Snakie'

/** The Keep a Changelog sections, in the order a release section prints them. */
const TYPES = ['added', 'changed', 'deprecated', 'removed', 'fixed', 'security']
const HEADING = {
  added: 'Added',
  changed: 'Changed',
  deprecated: 'Deprecated',
  removed: 'Removed',
  fixed: 'Fixed',
  security: 'Security'
}

/** `1246-detect-firmware-modules.added.md` → `{ type, issue, slug }`. */
export function parseName(file) {
  const m = /^(.+)\.([a-z]+)\.md$/.exec(file)
  if (!m) return null
  const [, stem, type] = m
  if (!TYPES.includes(type)) return null
  const issued = /^(\d+)-(.*)$/.exec(stem)
  return { type, issue: issued ? Number(issued[1]) : null, slug: issued ? issued[2] : stem }
}

/**
 * Every fragment on disk, sorted the way they will be read: by type, then by
 * issue number (unnumbered last), so the order is stable across machines
 * rather than whatever `readdir` happens to hand back.
 */
function readFragments() {
  if (!existsSync(DIR)) return []
  return readdirSync(DIR)
    .filter((f) => f.endsWith('.md') && f !== 'README.md')
    .map((file) => {
      const meta = parseName(file)
      if (!meta) {
        throw new Error(
          `${join(DIR, file)}: name must be <issue>-<slug>.<type>.md with <type> one of ${TYPES.join(', ')}`
        )
      }
      const body = readFileSync(join(DIR, file), 'utf8').trim()
      if (!body) throw new Error(`${join(DIR, file)}: is empty`)
      return { ...meta, file, body }
    })
    .sort(
      (a, b) =>
        TYPES.indexOf(a.type) - TYPES.indexOf(b.type) ||
        (a.issue ?? Infinity) - (b.issue ?? Infinity) ||
        a.slug.localeCompare(b.slug)
    )
}

/** Split a changelog section body into `{ Heading: [chunk, …] }`, in order. */
export function bucketsOf(body) {
  const buckets = new Map()
  let heading = null
  let lines = []
  const flush = () => {
    if (!heading) return
    const text = lines.join('\n').trim()
    if (text) buckets.set(heading, [...(buckets.get(heading) ?? []), text])
    lines = []
  }
  for (const line of body.split('\n')) {
    const m = /^### +(.+?) *$/.exec(line)
    if (m) {
      flush()
      heading = m[1]
    } else if (heading) {
      lines.push(line)
    }
  }
  flush()
  return buckets
}

/**
 * Render `### Heading` blocks from buckets plus fragments. Headings a release
 * actually used come first in Keep a Changelog order; anything unrecognised
 * (a hand-typed heading in an old `[Unreleased]`) keeps its place at the end
 * rather than being dropped on the floor.
 */
export function renderSections(buckets, fragments) {
  const merged = new Map()
  const add = (headingName, text) =>
    merged.set(headingName, [...(merged.get(headingName) ?? []), text])
  for (const [headingName, chunks] of buckets) for (const c of chunks) add(headingName, c)
  for (const f of fragments) add(HEADING[f.type], f.body)

  const known = TYPES.map((t) => HEADING[t])
  const order = [
    ...known.filter((h) => merged.has(h)),
    ...[...merged.keys()].filter((h) => !known.includes(h))
  ]
  return order.map((h) => `### ${h}\n\n${merged.get(h).join('\n\n')}`).join('\n\n')
}

/** The `## [Unreleased]` section: its body, and where it sits in the file. */
export function unreleasedSection(text) {
  const start = text.indexOf('## [Unreleased]')
  if (start < 0) throw new Error(`${CHANGELOG}: no "## [Unreleased]" heading`)
  const after = text.indexOf('\n## [', start + 1)
  const end = after < 0 ? text.length : after + 1
  const body = text.slice(start + '## [Unreleased]'.length, end)
  return { start, end, body }
}

function cmdNew(argv) {
  const [type, ...rest] = argv
  const titleParts = []
  let issue = null
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--issue') issue = rest[++i]
    else titleParts.push(rest[i])
  }
  const title = titleParts.join(' ').trim()
  if (!TYPES.includes(type) || !title) {
    throw new Error(`usage: changelog new <${TYPES.join('|')}> "Short title" [--issue 1246]`)
  }
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .split('-')
    .slice(0, 6)
    .join('-')
  mkdirSync(DIR, { recursive: true })
  const file = join(DIR, `${issue ? `${issue}-` : ''}${slug}.${type}.md`)
  if (existsSync(file)) throw new Error(`${file}: already exists`)
  writeFileSync(file, `- **${title}${issue ? ` (#${issue})` : ''}.** \n`)
  process.stdout.write(`${file}\n`)
}

function cmdPreview() {
  const fragments = readFragments()
  if (!fragments.length) {
    process.stdout.write('No pending changelog fragments.\n')
    return
  }
  process.stdout.write(`${renderSections(new Map(), fragments)}\n`)
}

/**
 * The CI guard. A pull request that changes shipping code should carry a
 * fragment; one that only moves CI, docs or tests around need not.
 */
/**
 * Unresolved conflict markers have been committed to CHANGELOG.md before and
 * shipped on master, which is what a file everybody edits at once eventually
 * buys you. Cheap to catch, so catch it.
 */
export function conflictMarkersIn(text) {
  return text
    .split('\n')
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => /^(<{7} |={7}$|>{7} )/.test(line))
    .map(({ n, line }) => `line ${n}: ${line}`)
}

function cmdCheck(argv) {
  const base = argv[argv.indexOf('--base') + 1] || 'origin/master'
  const changed = argv.includes('--files')
    ? argv.slice(argv.indexOf('--files') + 1)
    : execSync(`git diff --name-only ${base}...HEAD`, { encoding: 'utf8' })
        .split('\n')
        .filter(Boolean)

  for (const file of [CHANGELOG, ...changed.filter((f) => f.startsWith(`${DIR}/`))]) {
    if (!existsSync(file)) continue
    const markers = conflictMarkersIn(readFileSync(file, 'utf8'))
    if (markers.length) {
      throw new Error(`${file}: unresolved conflict markers\n${markers.map((m) => `  ${m}`).join('\n')}`)
    }
  }

  if (changed.some((f) => f.startsWith(`${DIR}/`) && f.endsWith('.md'))) {
    process.stdout.write('Changelog fragment present.\n')
    return
  }
  const shipping = changed.filter(
    (f) =>
      (f.startsWith('src/') ||
        f.startsWith('python/snakie/') ||
        f.startsWith('micropython/') ||
        f.startsWith('examples/plugins/')) &&
      !f.endsWith('.test.ts') &&
      !f.endsWith('.test.tsx')
  )
  if (!shipping.length) {
    process.stdout.write('No shipping code changed; no fragment needed.\n')
    return
  }
  // A branch that still edits CHANGELOG.md carries an entry, so it passes —
  // the guard exists to catch a MISSING entry, not to strand the pull requests
  // that were already open when fragments arrived. It says so, loudly.
  if (changed.includes(CHANGELOG)) {
    process.stdout.write(
      `${CHANGELOG} was edited directly. That still counts, but it is what makes pull requests ` +
        `conflict: put the entry in a ${DIR}/ fragment instead ` +
        `(npm run changelog -- new added "…" --issue N). See ${DIR}/README.md.\n`
    )
    return
  }
  throw new Error(
    `This branch changes shipping code but adds no ${DIR}/ fragment:\n` +
      shipping.map((f) => `  ${f}`).join('\n') +
      `\n\nAdd one with: npm run changelog -- new added "Short title" --issue N\n` +
      `Or label the pull request "no changelog" if it genuinely needs no entry.`
  )
}

function cmdRelease(argv) {
  const version = argv[0]
  if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) {
    throw new Error('usage: changelog release <X.Y.Z> [--date YYYY-MM-DD]')
  }
  const date = argv.includes('--date')
    ? argv[argv.indexOf('--date') + 1]
    : new Date().toISOString().slice(0, 10)

  const fragments = readFragments()
  const text = readFileSync(CHANGELOG, 'utf8')
  const { start, end, body } = unreleasedSection(text)
  const sections = renderSections(bucketsOf(body), fragments)
  if (!sections) throw new Error('Nothing to release: no fragments and an empty [Unreleased].')

  const released = `## [Unreleased]\n\n## [${version}] - ${date}\n\n${sections}\n\n`
  let out = text.slice(0, start) + released + text.slice(end)

  // Compare links live at the bottom, newest first: point [Unreleased] at the
  // new tag and slot the new version above whatever was previously newest.
  const prev = /^\[Unreleased\]: .*compare\/v(\d+\.\d+\.\d+)\.\.\.HEAD$/m.exec(out)
  if (!prev) throw new Error(`${CHANGELOG}: no "[Unreleased]: …compare/vX.Y.Z...HEAD" link to update`)
  out = out.replace(
    prev[0],
    `[Unreleased]: ${REPO}/compare/v${version}...HEAD\n` +
      `[${version}]: ${REPO}/compare/v${prev[1]}...v${version}`
  )

  writeFileSync(CHANGELOG, out)
  for (const f of fragments) rmSync(join(DIR, f.file))
  process.stdout.write(
    `${CHANGELOG}: wrote [${version}] - ${date} from ${fragments.length} fragment(s) ` +
      `plus the existing [Unreleased] body.\n`
  )
}

/** Only dispatch when run as a script — the helpers above are unit-tested. */
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [command, ...argv] = process.argv.slice(2)
  try {
    if (command === 'new') cmdNew(argv)
    else if (command === 'preview') cmdPreview()
    else if (command === 'check') cmdCheck(argv)
    else if (command === 'release') cmdRelease(argv)
    else throw new Error('usage: changelog <new|preview|check|release> …')
  } catch (err) {
    process.stderr.write(`${err.message}\n`)
    process.exitCode = 1
  }
}
