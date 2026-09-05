#!/usr/bin/env node
/**
 * THUMBNAILS FOR THE BOARDS UPSTREAM HAS NO PHOTO OF (#942).
 * =============================================================================
 *
 * `build-board-index.mjs` makes a thumbnail for each of the 225 upstream boards
 * from micropython.org's own media. The overlay boards (`board-overlay.ts`) are
 * not in that media by definition — upstream does not know they exist — so their
 * cards drew the placeholder from #931 while their DETAILS page showed a real
 * photograph, because #934 linked them to a part and parts carry board photos.
 * One board, two answers, and the wrong one where people look first.
 *
 * The photo the details page shows is the part's, so that is what the card gets.
 *
 * WHY THIS IS A BUILD STEP AND NOT A FALLBACK IN THE UI. The obvious version —
 * "no thumb? use the linked part's image" — means the gallery holds the parts
 * library open to render its tiles. Part images are the full-resolution article:
 * 28 MB across the Standard library, 180 KB to 1.7 MB each, and `listLibraries`
 * inlines every one of them as a data URI. That is a lot of megabytes to open a
 * panel with, to draw seven pictures about 200 px wide. Shrunk here instead they
 * are ~20 KB each, and they travel the same path as every other board's
 * thumbnail rather than a second one that can rot on its own.
 *
 * Re-run it when a linked part's image changes:
 *
 *     node scripts/build-overlay-thumbs.mjs
 *
 * It is deliberately not wired into `npm run build`: it rewrites committed
 * binaries, and a build should not do that behind your back.
 */
import { execFile } from 'node:child_process'
import { copyFile, mkdir, readFile, rm, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

/**
 * The longest side of a thumbnail, matching `build-board-index.mjs` so every
 * tile in the gallery is drawn from the same size of picture.
 *
 * A BOX, not a width, and never an upscale — which is the difference between
 * this and the board index. Upstream's photos are all landscape product shots;
 * part images are the board itself, and some of these boards are long and thin.
 * Forcing the Pico LiPo 2 XL W's 141x512 render to 320 wide made a 320x1162
 * image: 2.3x upscaled, 102 KB, and drawn at a fraction of that in a 4:3 tile.
 * Fitting it in the box instead gives 88x320 and 20 KB, identical on screen.
 */
const THUMB_MAX = 320

const OVERLAY = 'src/shared/board-overlay.ts'
const LINKS = 'src/shared/board-part-link.ts'
const PARTS = 'examples/parts'
const OUT = 'src/renderer/public/boards/thumbs'

/** The overlay's board ids, in file order. */
export function overlayIds(source) {
  return [...source.matchAll(/^ {4}id: '([^']+)',$/gm)].map((m) => m[1])
}

/** Every board→part pairing in the link table. */
export function linkPairs(source) {
  const re =
    /boardId: '([^']+)',\s*\n\s*libraryId: STD,\s*\n\s*partId: '([^']+)'/g
  return [...source.matchAll(re)].map((m) => ({ boardId: m[1], partId: m[2] }))
}

/** The part's board photo, whatever it is called, or null. */
function partImage(partId) {
  for (const name of ['image.png', 'image.jpg', 'image.jpeg', 'image.webp']) {
    const p = join(PARTS, 'snakie-standard', partId, name)
    if (existsSync(p)) return p
  }
  return null
}

/** The pixel dimensions of an image, or null if they cannot be read. */
async function dimensions(path) {
  try {
    const { stdout } = await run('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', path])
    const w = Number(stdout.match(/pixelWidth:\s*(\d+)/)?.[1])
    const h = Number(stdout.match(/pixelHeight:\s*(\d+)/)?.[1])
    return w && h ? { w, h } : null
  } catch {
    return null
  }
}

/**
 * Shrink one image into the box. The same three-tool ladder the board index uses.
 *
 * Part images are transparent cut-outs and JPEG carries no alpha, so the
 * background flattens to white — which is what was wanted anyway: upstream's own
 * thumbnails are product shots on white, and a cut-out floating on the panel
 * colour would have been the one tile in the gallery that looked different.
 */
async function thumbnail(src, dest) {
  await copyFile(src, dest)
  // `>` is "only shrink" — ImageMagick's own guard against upscaling.
  for (const [cmd, args] of [
    ['magick', [dest, '-resize', `${THUMB_MAX}x${THUMB_MAX}>`, '-quality', '60', dest]],
    ['convert', [dest, '-resize', `${THUMB_MAX}x${THUMB_MAX}>`, '-quality', '60', dest]]
  ]) {
    try {
      await run(cmd, args)
      return true
    } catch {
      /* try the next one */
    }
  }
  try {
    // `sips` has no "only shrink", so the check is ours to make.
    const size = await dimensions(dest)
    if (!size || Math.max(size.w, size.h) > THUMB_MAX) {
      await run('sips', ['--resampleHeightWidthMax', String(THUMB_MAX), dest, '--out', dest])
    }
    await run('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '60', dest, '--out', dest])
    return true
  } catch {
    // No resizer on this machine. A full-size part photo is up to 1.7 MB, so
    // shipping the original would be worse than the placeholder it replaces.
    await rm(dest, { force: true })
    return false
  }
}

async function main() {
  const ids = new Set(overlayIds(await readFile(OVERLAY, 'utf8')))
  const pairs = linkPairs(await readFile(LINKS, 'utf8')).filter((p) => ids.has(p.boardId))
  await mkdir(OUT, { recursive: true })

  const made = []
  const skipped = []
  for (const { boardId, partId } of pairs) {
    const src = partImage(partId)
    if (!src) {
      skipped.push(`${boardId} — ${partId} ships no board image`)
      continue
    }
    const dest = join(OUT, `${boardId}.jpg`)
    if (await thumbnail(src, dest)) {
      made.push(`${boardId}.jpg  ${Math.round((await stat(dest)).size / 1024)} KB  ← ${partId}`)
    } else {
      skipped.push(`${boardId} — no image resizer on this machine`)
    }
  }

  console.log(`overlay boards linked to a part: ${pairs.length}`)
  for (const m of made) console.log(`  ✓ ${m}`)
  for (const s of skipped) console.log(`  · ${s}`)
  console.log(
    `\n${made.length} thumbnail(s) written to ${OUT}.` +
      `\nAdd \`thumb: '<ID>.jpg'\` to the matching entry in ${OVERLAY} for each.`
  )
}

// Importable for the tests without running the generator.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*\//, ''))) {
  await main()
}
