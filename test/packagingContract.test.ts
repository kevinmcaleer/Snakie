import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { parse } from 'yaml'

/**
 * THE PACKAGING CONTRACT — what the app accepts vs what the installer ships.
 * =============================================================================
 *
 * `electron-builder.yml` copies the bundled Standard parts library into the
 * packaged app through an explicit **allow-list of globs**. `src/main/parts/`
 * `library.ts` decides which asset formats a part may use. Those two lists are
 * written in different languages, in different files, by different concerns —
 * and nothing connects them.
 *
 * When they disagree the failure is invisible in development and total in
 * production: the asset loads fine from the repo under `npm run dev`, is left
 * out of the installer, and the part ships with no photo. It has to reach a real
 * user before anyone finds out. That is exactly what happened when part photos
 * moved to `.webp` (a cut-out photo wants alpha, so webp is the natural choice)
 * and when parts gained bundled `help.md` documents.
 *
 * These tests make the two files agree, so adding a format to `IMAGE_EXTS`
 * fails here until the packaging glob exists.
 */

const ROOT = resolve(__dirname, '..')

/** The parts-library asset formats the main process will read. */
function imageExtsFromSource(): string[] {
  const src = readFileSync(resolve(ROOT, 'src/main/parts/library.ts'), 'utf8')
  const m = src.match(/const IMAGE_EXTS\s*=\s*\[([^\]]*)\]/)
  // Read from source text because `library.ts` imports `electron`, which a node
  // test can't load. If the declaration is ever reformatted past this regex the
  // assertions below fail loudly rather than passing on an empty list.
  if (!m) throw new Error('could not find `const IMAGE_EXTS = [...]` in src/main/parts/library.ts')
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])
}

/** The globs electron-builder uses to copy the bundled parts library. */
function partsLibraryFilter(): string[] {
  const cfg = parse(readFileSync(resolve(ROOT, 'electron-builder.yml'), 'utf8')) as {
    extraResources?: { from?: string; filter?: string[] }[]
  }
  const entry = (cfg.extraResources ?? []).find((r) => r.from === 'examples/parts/snakie-standard')
  if (!entry) throw new Error('no `examples/parts/snakie-standard` entry in electron-builder.yml')
  return entry.filter ?? []
}

const IMAGE_EXTS = imageExtsFromSource()
const FILTER = partsLibraryFilter()

describe('bundled parts library packaging contract', () => {
  it('reads both lists (guards the extraction itself)', () => {
    expect(IMAGE_EXTS.length).toBeGreaterThan(0)
    expect(IMAGE_EXTS).toContain('png')
    expect(FILTER.length).toBeGreaterThan(0)
  })

  // The one that has actually bitten: a format the app accepts but the installer
  // never copies. Named per-extension so the failure says which one is missing.
  it.each(IMAGE_EXTS)('the installer ships part photos in .%s', (ext) => {
    expect(FILTER).toContain(`**/*.${ext}`)
  })

  it('ships the part definitions and their bundled help documents', () => {
    expect(FILTER).toContain('**/*.yml') // parts.yml — the part itself
    expect(FILTER).toContain('**/*.md') // help.md — the bundled offline help
  })
})
