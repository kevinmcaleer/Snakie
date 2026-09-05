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
 * WHAT UPSTREAM DOES NOT PUBLISH IN `board.json`: flash size, RAM size, and
 * whether the board also runs CircuitPython. `features` carries `External Flash`
 * and `External RAM` as booleans and nothing more.
 *
 * It does, though, publish sizes NEXT to `board.json`, in the build
 * configuration each board needs to compile at all — which is a better citation
 * than a product page, because it is what the firmware people flash was built
 * against. `board-config.mjs` reads those, one small reader per port;
 * `board-specs.mjs` turns a chip name into a datasheet figure and holds the
 * curation for everything neither can reach. Every number ends up with a
 * `source` — see #897 for why one without is not published at all.
 *
 * Run:  node scripts/build-board-index.mjs [--tag v1.29.0] [--no-images]
 *       node scripts/build-board-index.mjs --specs-only
 *
 * `--specs-only` re-reads the committed `boards.json` and rewrites just the
 * derived fields — sizes, runtimes, CircuitPython ids. It exists because the
 * curation in `board-specs.mjs` changes far more often than upstream's tree
 * does, and a full run re-encodes 217 thumbnails into an unreviewable binary
 * diff to say nothing about them. It still needs the network: the sizes are
 * read from upstream's tree, not remembered.
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
import {
  PORT_CONFIG_FILES,
  nrfMemoryScriptsFor,
  picoSdkBoardFor,
  readBoardConfig
} from './board-config.mjs'

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

/**
 * Upstream's whole file listing at `tag`, one API call.
 *
 * Worth keeping whole rather than filtering to `board.json` on the way past: the
 * same response says which per-board config files exist (so #897's readers ask
 * for nothing that would 404) and pins the pico-sdk revision, which is a
 * submodule and therefore a `commit` entry carrying its sha.
 */
async function repoTree(tag) {
  const tree = await getJson(`${GH}/git/trees/${tag}?recursive=1`, ghHeaders())
  if (tree.truncated) throw new Error('tree response was truncated — cannot enumerate boards')
  return tree.tree
}

/** Every `board.json` path in the tree. */
function boardPaths(tree) {
  return tree
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
 * What MicroPython's own tree says about each board's hardware (#897).
 *
 * Two passes, because rp2's answer may live in a pico-sdk header whose NAME is
 * only known once the board's `mpconfigboard.cmake` has been read. `tree` is
 * consulted first so nothing is requested that does not exist — a 404 per board
 * is both rude and slow against someone else's hosting.
 *
 * A board whose files cannot be fetched yields `{}`, which reads downstream as
 * "nothing known", not as an error: this enriches the index, it does not gate it.
 */
async function gatherConfigs(tag, boards, tree) {
  const present = new Set(tree.map((e) => e.path))
  const picoSdkSha = tree.find((e) => e.path === 'lib/pico-sdk' && e.type === 'commit')?.sha ?? null

  const fetched = await pooled(boards, CONCURRENCY, async (b) => {
    const dir = `ports/${b.port}/boards/${b.id}`
    const files = {}
    for (const name of PORT_CONFIG_FILES[b.port] ?? []) {
      if (present.has(`${dir}/${name}`)) files[name] = await getText(`${RAW}/${tag}/${dir}/${name}`)
    }
    // A pico-sdk board header the board ships itself — the strongest rp2 source,
    // because nobody writes one of these about somebody else's board.
    const ownHeaders = {}
    if (b.port === 'rp2') {
      for (const e of tree) {
        if (!e.path.startsWith(`${dir}/`) || !e.path.endsWith('.h')) continue
        const name = e.path.slice(dir.length + 1)
        if (name === 'mpconfigboard.h' || name.includes('/')) continue
        ownHeaders[name] = await getText(`${RAW}/${tag}/${e.path}`)
      }
    }
    return { files, ownHeaders }
  })

  // Second pass: the files those configs turned out to name — pico-sdk board
  // headers, and the nrf memory maps that are the only thing separating an
  // nRF52832 QFAA from a QFAB. Both are shared between boards, so they are
  // gathered once by name rather than per board.
  //
  // The pico-sdk is fetched at the revision MicroPython PINS, not at whatever is
  // newest, so the figure is the one this firmware was built against. That is
  // not a formality: the pinned revision gives the XIAO RP2350 2 MB, agreeing
  // with Seeed, where a later pico-sdk gives 4 MB.
  const picoHeaders = new Map()
  const nrfScripts = new Map()
  boards.forEach((b, i) => {
    const got = fetched[i]
    if (!got?.files) return
    if (b.port === 'rp2' && picoSdkSha) {
      const name = picoSdkBoardFor(got.files, b.id)
      if (name) picoHeaders.set(name, null)
    }
    if (b.port === 'nrf') {
      for (const name of nrfMemoryScriptsFor(got.files)) {
        if (present.has(`ports/nrf/boards/${name}`)) nrfScripts.set(name, null)
      }
    }
  })
  await Promise.all([
    fetchInto(picoHeaders, (name) =>
      getText(
        `https://raw.githubusercontent.com/raspberrypi/pico-sdk/${picoSdkSha}/src/boards/include/boards/${name}.h`
      )
    ),
    fetchInto(nrfScripts, (name) => getText(`${RAW}/${tag}/ports/nrf/boards/${name}`))
  ])

  const out = new Map()
  boards.forEach((b, i) => {
    const got = fetched[i]
    if (!got?.files) return out.set(b.id, {})
    out.set(
      b.id,
      readBoardConfig(b.port, got.files, {
        boardId: b.id,
        ownHeaders: got.ownHeaders,
        picoSdkHeaders: Object.fromEntries(picoHeaders),
        // Only the scripts THIS board names, so a board never sees another's.
        nrfScripts: Object.fromEntries(
          nrfMemoryScriptsFor(got.files)
            .map((name) => [name, nrfScripts.get(name)])
            .filter(([, text]) => typeof text === 'string')
        )
      })
    )
  })
  return out
}

/** Fill a `name → null` map with `fetch(name)`, dropping whatever fails. */
async function fetchInto(map, fetchOne) {
  const names = [...map.keys()]
  const got = await pooled(names, CONCURRENCY, fetchOne)
  names.forEach((name, i) => {
    if (typeof got[i] === 'string') map.set(name, got[i])
  })
}

/**
 * Attach the derived fields to every board, in place.
 *
 * Shared by the full run and `--specs-only` so the two cannot drift: a seed
 * enriched by the quick path has to be byte-identical to one the slow path would
 * have produced, or the quick path is just a second, worse generator.
 */
function addSpecs(boards, cpIndex, configs) {
  const derived = ['flash', 'externalFlash', 'ram', 'psram', 'circuitPythonBoardId', 'runtimes']
  for (const b of boards) {
    const { flash, externalFlash, ram, psram } = specsForBoard(b, configs?.get(b.id) ?? {})
    const circuitPythonBoardId = cpIndex ? circuitPythonIdFor(b, cpIndex) : null
    // Cleared and re-set in one order, so a seed enriched by `--specs-only`
    // matches one the full run wrote KEY FOR KEY. Assigning over the existing
    // fields instead would leave a field added since the seed was last built
    // sitting at the end of the object, and the two paths would differ in a diff
    // while agreeing on every value.
    for (const key of derived) delete b[key]
    b.flash = flash
    b.externalFlash = externalFlash
    b.ram = ram
    b.psram = psram
    b.circuitPythonBoardId = circuitPythonBoardId
    b.runtimes = runtimesForBoard(b, circuitPythonBoardId)
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

/**
 * Report what is known and what is not, because the gaps are the point (#897).
 *
 * Broken down by vendor as well as in total: "flash on 195 of 225" hides that a
 * whole maker's range is missing, and which maker it is decides whether the
 * gallery can offer a size filter without quietly dropping them.
 */
function reportCoverage(boards) {
  const n = (f) => boards.filter(f).length
  process.stderr.write(
    `  flash size on ${n((b) => b.flash)}/${boards.length}, ` +
      `external flash on ${n((b) => b.externalFlash)}, ` +
      `RAM on ${n((b) => b.ram)}, external RAM on ${n((b) => b.psram)}, ` +
      `CircuitPython confirmed on ${n((b) => b.circuitPythonBoardId)}\n`
  )
  const byVendor = new Map()
  for (const b of boards) {
    const row = byVendor.get(b.vendor) ?? { total: 0, flash: 0, ram: 0 }
    row.total += 1
    if (b.flash) row.flash += 1
    if (b.ram) row.ram += 1
    byVendor.set(b.vendor, row)
  }
  for (const [vendor, row] of [...byVendor].sort((a, b) => b[1].total - a[1].total)) {
    if (row.flash === row.total && row.ram === row.total) continue
    process.stderr.write(
      `    ${vendor}: flash ${row.flash}/${row.total}, RAM ${row.ram}/${row.total}\n`
    )
  }
}

/** Rewrite the committed seed's derived fields without touching anything else. */
async function specsOnly() {
  const path = join(OUT_DIR, 'boards.json')
  const doc = JSON.parse(await readFile(path, 'utf8'))
  const tag = value('--tag', null) ?? doc.micropython
  process.stderr.write(`Re-deriving specs for ${doc.boards.length} boards in ${path} (${tag})\n`)
  const configs = await gatherConfigs(tag, doc.boards, await repoTree(tag))
  addSpecs(doc.boards, await loadCircuitPython(), configs)
  doc.generated = new Date().toISOString().slice(0, 10)
  await writeFile(path, `${JSON.stringify(doc, null, 2)}\n`)
  reportCoverage(doc.boards)
}

async function main() {
  if (flag('--specs-only')) return specsOnly()
  const tag = value('--tag', null) ?? (await newestReleaseTag())
  const withImages = !flag('--no-images')
  process.stderr.write(`Building board index from MicroPython ${tag}\n`)

  const tree = await repoTree(tag)
  const paths = boardPaths(tree)
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
    const named = (meta.images ?? [])[0] ?? null
    // What the board's `board.json` SAYS its picture is. Whether that file
    // exists is a separate question, answered just below.
    let image = named ? `${MPY}/resources/micropython-media/boards/${p.board}/${named}` : null
    let thumb = null
    if (withImages && image) {
      try {
        const res = await fetch(image)
        if (res.ok) {
          const bytes = Buffer.from(await res.arrayBuffer())
          const name = `${p.board}.jpg`
          if (await thumbnail(bytes, join(OUT_DIR, 'thumbs', name))) thumb = name
        } else {
          // Upstream names a file its media repo does not publish at that path,
          // and seven boards do (#931). Recording the URL anyway would hand the
          // details page a link to a 404 — so the board has no picture, which
          // is the truth and what the gallery's placeholder is for. NOT the
          // same as the two failures either side of this: a `catch` here is the
          // network, and a `thumbnail` that returns false is this machine
          // having no resizer. Both leave the URL alone, because in both the
          // picture is presumed to be there.
          image = null
        }
      } catch {
        /* no picture this run; the tile falls back to a placeholder */
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
      image,
      thumb,
      builds
    }
  })

  const ok = boards.filter((b) => b && !b.error)
  const failed = boards.length - ok.length
  ok.sort((a, b) => a.vendor.localeCompare(b.vendor) || a.product.localeCompare(b.product))
  addSpecs(ok, await loadCircuitPython(), await gatherConfigs(tag, ok, tree))

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
