/**
 * BOARD INDEX GENERATOR (#893, epic #884).
 * =============================================================================
 *
 * Builds `boards.json` — every board MicroPython publishes firmware for, with
 * what it is, what it can do, which builds exist and where its picture lives —
 * plus the bundled thumbnails the Board Finder gallery draws.
 *
 * WHY GENERATED, AND WHY NOT AT BUILD TIME. Snakie's firmware picker shows
 * Thonny's catalogue, which carries no Adafruit boards and no ESP32 variants —
 * which is how a Feather V2 owner picked "ESP32 / WROOM", flashed a build
 * without SPIRAM, and lost a week to a board whose 2 MB of PSRAM was switched
 * off. Upstream publishes all of it, in `ports/<port>/boards/<BOARD>/board.json`.
 *
 * The index is DETACHED from the app rather than compiled into it: baked in, a
 * board added upstream on Tuesday would wait for the next Snakie release.
 * Fetched, it is in the picker on Wednesday, on the copy people already have.
 * The generated document ships to a repo Snakie reads at runtime; a copy is also
 * committed here as the bundled seed, so a fresh install and the offline
 * classroom build (#267) work with no network at all.
 *
 * WHAT UPSTREAM DOES NOT PUBLISH: flash size, RAM size, and whether the board
 * also runs CircuitPython. `features` carries `External Flash` and `External
 * RAM` as booleans and nothing more. Those come from `board-specs.mjs` instead,
 * which is where every figure's provenance lives — see #897 for why a number
 * with no `source` is not published at all.
 *
 * Run:  node scripts/build-board-index.mjs [--tag v1.29.0] [--no-images]
 *       node scripts/build-board-index.mjs --specs-only
 *
 * `--specs-only` re-reads the committed `boards.json` and rewrites just the
 * derived fields — sizes, runtimes, CircuitPython ids. It exists because the
 * curation in `board-specs.mjs` changes far more often than upstream's tree
 * does, and a full run re-encodes 217 thumbnails into an unreviewable binary
 * diff to say nothing about them.
 */
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  CIRCUITPYTHON_CATALOGS,
  circuitPythonIdFor,
  circuitPythonIndex,
  runtimesForBoard,
  specsForBoard
} from './board-specs.mjs'

const run = promisify(execFile)
const HERE = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(HERE, '..', 'src', 'renderer', 'public', 'boards')

/** The document's shape, so a client can refuse one it does not understand. */
const SCHEMA = 1

const GH = 'https://api.github.com/repos/micropython/micropython'
const RAW = 'https://raw.githubusercontent.com/micropython/micropython'
const MPY = 'https://micropython.org'

/** Thumbnail width. Enough for a gallery tile at 2×, small enough to bundle. */
const THUMB_WIDTH = 320

/**
 * How many MicroPython VERSIONS of each board to keep, with all their variants.
 *
 * Upstream keeps every build ever published — 110 for the busiest board, 3,172
 * across the catalogue, which is most of a megabyte of JSON that a client
 * re-downloads to learn nothing. Two matches the depth Thonny's catalogue
 * offers: the current release, which is what the picker defaults to, and one
 * back, which is what you want the day the new one breaks something.
 */
const KEEP_VERSIONS = 2

/**
 * How many requests to have in flight at once.
 *
 * Step 3 asks micropython.org for a page per board. Politeness is not optional
 * when the whole run is ~225 of them against someone else's free hosting.
 */
const CONCURRENCY = 6

const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const value = (name, fallback) => {
  const i = args.indexOf(name)
  return i === -1 ? fallback : args[i + 1]
}

/** GitHub allows far more when a token is present; CI always has one. */
function ghHeaders() {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
  return {
    Accept: 'application/vnd.github+json',
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  }
}

async function getJson(url, headers = {}) {
  const res = await fetch(url, { headers })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`)
  return res.json()
}

async function getText(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`)
  return res.text()
}

/** Map `fn` over `items` with a bounded number in flight. */
async function pooled(items, limit, fn) {
  const out = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      try {
        out[i] = await fn(items[i], i)
      } catch (err) {
        out[i] = { error: err instanceof Error ? err.message : String(err) }
      }
    }
  })
  await Promise.all(workers)
  return out
}

/**
 * The newest STABLE release tag.
 *
 * Deliberately not `master`: a board still in development there has no published
 * firmware, so it would appear in the picker and flash nothing. Previews are
 * skipped for the same reason a user should not be handed one by default.
 */
async function newestReleaseTag() {
  const tags = await getJson(`${GH}/tags?per_page=100`, ghHeaders())
  const stable = tags
    .map((t) => t.name)
    .filter((n) => /^v\d+\.\d+(\.\d+)?$/.test(n))
    .sort((a, b) => {
      const p = (v) => v.slice(1).split('.').map(Number)
      const [aa, ab, ac = 0] = p(a)
      const [ba, bb, bc = 0] = p(b)
      return ba - aa || bb - ab || bc - ac
    })
  if (stable.length === 0) throw new Error('no stable release tag found')
  return stable[0]
}

/** Every `board.json` path in the tree, one API call. */
async function boardPaths(tag) {
  const tree = await getJson(`${GH}/git/trees/${tag}?recursive=1`, ghHeaders())
  if (tree.truncated) throw new Error('tree response was truncated — cannot enumerate boards')
  return tree.tree
    .filter((e) => e.path.endsWith('/board.json'))
    .map((e) => ({ path: e.path, port: e.path.split('/')[1], board: e.path.split('/')[3] }))
}

/**
 * Firmware builds published for one board, newest first.
 *
 * Read off the board's download page, which is the only place that says what
 * was actually BUILT — the tree says what exists in source, which is not the
 * same thing. Filenames are `<BOARD>[-<VARIANT>]-<YYYYMMDD>-v<version>.<ext>`;
 * the 8-digit date is what makes the board token unambiguous, since a board
 * name may itself contain hyphens.
 */
function parseBuilds(html, board) {
  const out = []
  const seen = new Set()
  const re = /href="(\/resources\/firmware\/([^"]+?)-(\d{8})-v([^"/]+?)\.(bin|uf2|hex|app-bin))"/g
  let m
  while ((m = re.exec(html))) {
    const [, href, name, date, version, ext] = m
    if (ext === 'app-bin') continue // the OTA half, not a flashable image
    if (name !== board && !name.startsWith(`${board}-`)) continue
    if (version.includes('preview')) continue
    const variant = name === board ? null : name.slice(board.length + 1)
    const key = `${name}-${date}-v${version}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ build: name, variant, version, date, url: `${MPY}${href}` })
  }
  // Newest first: date descending, so the picker's default is the current one.
  out.sort((a, b) => b.date.localeCompare(a.date))
  // Then keep only the most recent few VERSIONS — all variants of each, since
  // dropping a variant is exactly how a board ends up on the wrong build.
  const keep = []
  for (const b of out) if (!keep.includes(b.version)) keep.push(b.version)
  const wanted = new Set(keep.slice(0, KEEP_VERSIONS))
  return out.filter((b) => wanted.has(b.version))
}

/** Shrink one image to a thumbnail. Uses whatever the machine has. */
async function thumbnail(srcBytes, destPath) {
  await writeFile(destPath, srcBytes)
  try {
    await run('magick', [destPath, '-resize', `${THUMB_WIDTH}x`, '-quality', '60', destPath])
    return true
  } catch {
    /* try the next one */
  }
  try {
    await run('convert', [destPath, '-resize', `${THUMB_WIDTH}x`, '-quality', '60', destPath])
    return true
  } catch {
    /* try the next one */
  }
  try {
    await run('sips', ['--resampleWidth', String(THUMB_WIDTH), destPath, '--out', destPath])
    // `sips` resamples at full quality, which for 217 product photos is 7.4 MB
    // of app. Re-encode at 60: still clean at gallery-tile size, 5.7 MB.
    await run('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '60', destPath, '--out', destPath])
    return true
  } catch {
    // No resizer. Keeping a 167 KB original per board would be 37 MB of app, so
    // drop it and let the gallery fall back to the remote URL for this one.
    await rm(destPath, { force: true })
    return false
  }
}

/**
 * Attach the derived fields to every board, in place.
 *
 * Shared by the full run and `--specs-only` so the two cannot drift: a seed
 * enriched by the quick path has to be byte-identical to one the slow path would
 * have produced, or the quick path is just a second, worse generator.
 */
function addSpecs(boards, cpIndex) {
  for (const b of boards) {
    const { flash, ram, psram } = specsForBoard(b)
    b.flash = flash
    b.ram = ram
    b.psram = psram
    b.circuitPythonBoardId = cpIndex ? circuitPythonIdFor(b, cpIndex) : null
    b.runtimes = runtimesForBoard(b, b.circuitPythonBoardId)
  }
  return boards
}

/** The CircuitPython catalogue, or null when it cannot be reached. */
async function loadCircuitPython() {
  try {
    const catalogs = await Promise.all(CIRCUITPYTHON_CATALOGS.map((u) => getJson(u)))
    return circuitPythonIndex(catalogs)
  } catch (err) {
    // Not fatal, and deliberately loud: a board index whose CircuitPython column
    // is silently empty looks exactly like one where no board runs it.
    process.stderr.write(`  WARNING: CircuitPython catalogue unavailable (${err.message})\n`)
    return null
  }
}

/** Report what is known and what is not, because the gaps are the point (#897). */
function reportCoverage(boards) {
  const n = (f) => boards.filter(f).length
  process.stderr.write(
    `  flash size on ${n((b) => b.flash)}/${boards.length}, ` +
      `RAM on ${n((b) => b.ram)}, PSRAM on ${n((b) => b.psram)}, ` +
      `CircuitPython confirmed on ${n((b) => b.circuitPythonBoardId)}\n`
  )
}

/** Rewrite the committed seed's derived fields without touching anything else. */
async function specsOnly() {
  const path = join(OUT_DIR, 'boards.json')
  const doc = JSON.parse(await readFile(path, 'utf8'))
  process.stderr.write(`Re-deriving specs for ${doc.boards.length} boards in ${path}\n`)
  addSpecs(doc.boards, await loadCircuitPython())
  doc.generated = new Date().toISOString().slice(0, 10)
  await writeFile(path, `${JSON.stringify(doc, null, 2)}\n`)
  reportCoverage(doc.boards)
}

async function main() {
  if (flag('--specs-only')) return specsOnly()
  const tag = value('--tag', null) ?? (await newestReleaseTag())
  const withImages = !flag('--no-images')
  process.stderr.write(`Building board index from MicroPython ${tag}\n`)

  const paths = await boardPaths(tag)
  process.stderr.write(`  ${paths.length} boards in the tree\n`)

  await mkdir(join(OUT_DIR, 'thumbs'), { recursive: true })

  const boards = await pooled(paths, CONCURRENCY, async (p) => {
    const meta = JSON.parse(await getText(`${RAW}/${tag}/${p.path}`))
    let builds = []
    try {
      builds = parseBuilds(await getText(`${MPY}/download/${p.board}/`), p.board)
    } catch {
      // No download page means no published firmware. The board still belongs in
      // the gallery — it is real, someone owns one — it just cannot be flashed
      // from here, and the UI says so rather than pretending.
    }
    const image = (meta.images ?? [])[0] ?? null
    let thumb = null
    if (withImages && image) {
      const url = `${MPY}/resources/micropython-media/boards/${p.board}/${image}`
      try {
        const bytes = Buffer.from(await (await fetch(url)).arrayBuffer())
        const name = `${p.board}.jpg`
        if (await thumbnail(bytes, join(OUT_DIR, 'thumbs', name))) thumb = name
      } catch {
        /* no picture; the tile falls back to a placeholder */
      }
    }
    return {
      id: p.board,
      port: p.port,
      vendor: meta.vendor ?? '',
      product: meta.product ?? p.board,
      mcu: meta.mcu ?? '',
      features: meta.features ?? [],
      // Upstream's own split: it has already decided which of its attributes
      // belong in a filter, so inherit that rather than re-deciding it.
      notes: meta.features_non_filterable ?? [],
      url: meta.url || null,
      variants: meta.variants ?? {},
      flashOffset: meta.deploy_options?.flash_offset ?? null,
      image: image ? `${MPY}/resources/micropython-media/boards/${p.board}/${image}` : null,
      thumb,
      builds
    }
  })

  const ok = boards.filter((b) => b && !b.error)
  const failed = boards.length - ok.length
  ok.sort((a, b) => a.vendor.localeCompare(b.vendor) || a.product.localeCompare(b.product))
  addSpecs(ok, await loadCircuitPython())

  const doc = {
    schema: SCHEMA,
    micropython: tag,
    generated: new Date().toISOString().slice(0, 10),
    boards: ok
  }
  await writeFile(join(OUT_DIR, 'boards.json'), `${JSON.stringify(doc, null, 2)}\n`)

  const withBuilds = ok.filter((b) => b.builds.length > 0).length
  const withThumbs = ok.filter((b) => b.thumb).length
  process.stderr.write(
    `  wrote ${ok.length} boards (${withBuilds} with published firmware, ` +
      `${withThumbs} with thumbnails${failed ? `, ${failed} failed` : ''})\n`
  )
  reportCoverage(ok)
}

main().catch((err) => {
  process.stderr.write(`build-board-index failed: ${err.message}\n`)
  process.exit(1)
})
