#!/usr/bin/env node
/**
 * PROMOTE KEVSROBOTS.COM CATALOG PARTS INTO THE STANDARD LIBRARY.
 * =============================================================================
 *
 * Snakie's Standard library (`examples/parts/snakie-standard/`) is the master
 * copy of the parts catalog. kevsrobots.com imports it
 * (`python -m projects_api.import_snakie_parts --github`). People also create
 * parts on the site, and those never reach Snakie on their own. This script
 * is the way back: it lists the site's catalog parts that the library doesn't
 * have, and with `--write` copies them in (parts.yml + photo + mesh) so a
 * maintainer can review them in a pull request.
 *
 *     node scripts/promote-kevsrobots-parts.mjs                 # list what's missing
 *     node scripts/promote-kevsrobots-parts.mjs --write         # copy all of them in
 *     node scripts/promote-kevsrobots-parts.mjs --write raspberry-pi-5 mg996-servos
 *     node scripts/promote-kevsrobots-parts.mjs --api http://localhost:8000
 *
 * A part is "already in the library" when its slug is a library folder, or
 * its name matches a library part's name (case and punctuation ignored), so
 * a site duplicate such as `sg90-servo` is reported, not copied.
 *
 * Copied parts get `version: 0.1.0` when they have none. Site photos carry no
 * licence record here: check each image before merging, as the Parts Library
 * epic asks.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse, stringify } from 'yaml'

const LIBRARY = join('examples', 'parts', 'snakie-standard')

const args = process.argv.slice(2)
const write = args.includes('--write')
const apiAt = args.indexOf('--api')
const API = (apiAt >= 0 ? args[apiAt + 1] : 'https://projects.kevsrobots.com').replace(/\/$/, '')
const only = args.filter((a, i) => !a.startsWith('--') && (apiAt < 0 || i !== apiAt + 1))

export function nameKey(name) {
  return String(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
}

function libraryParts() {
  const parts = []
  for (const id of readdirSync(LIBRARY)) {
    const yml = join(LIBRARY, id, 'parts.yml')
    if (!existsSync(yml)) continue
    const def = parse(readFileSync(yml, 'utf-8')) ?? {}
    parts.push({ id, name: def.name ?? id })
  }
  return parts
}

async function getJson(path) {
  const resp = await fetch(API + path)
  if (!resp.ok) throw new Error(`${path}: HTTP ${resp.status}`)
  return resp.json()
}

async function download(url, file) {
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`${url}: HTTP ${resp.status}`)
  writeFileSync(file, Buffer.from(await resp.arrayBuffer()))
}

const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }

async function promote(slug) {
  const resp = await fetch(`${API}/api/parts/${encodeURIComponent(slug)}/parts.yml`)
  if (!resp.ok) throw new Error(`parts.yml: HTTP ${resp.status}`)
  const def = parse(await resp.text()) ?? {}
  const dir = join(LIBRARY, slug)
  mkdirSync(dir, { recursive: true })
  if (typeof def.image === 'string' && /^https?:/.test(def.image)) {
    const img = await fetch(def.image)
    if (img.ok) {
      const type = (img.headers.get('content-type') ?? '').split(';')[0]
      const file = `image.${EXT[type] ?? 'png'}`
      writeFileSync(join(dir, file), Buffer.from(await img.arrayBuffer()))
      def.image = file
    } else {
      delete def.image
    }
  }
  if (typeof def.mesh === 'string' && /^https?:/.test(def.mesh)) {
    try {
      await download(def.mesh, join(dir, 'model.stl'))
      def.mesh = 'model.stl'
    } catch {
      delete def.mesh
    }
  }
  def.id = slug
  def.version ??= '0.1.0'
  def.headers ??= []
  writeFileSync(join(dir, 'parts.yml'), stringify(def, { lineWidth: 0 }))
  return def
}

async function main() {
  const lib = libraryParts()
  const ids = new Set(lib.map((p) => p.id))
  const names = new Map(lib.map((p) => [nameKey(p.name), p.id]))
  const catalog = await getJson('/api/parts/_catalog')
  const missing = []
  const duplicates = []
  for (const part of catalog) {
    if (ids.has(part.slug)) continue
    const same = names.get(nameKey(part.name))
    if (same) duplicates.push(`${part.slug} (same name as ${same})`)
    else missing.push(part)
  }
  const chosen = only.length ? missing.filter((p) => only.includes(p.slug)) : missing
  console.log(`${catalog.length} catalog parts, ${lib.length} library parts, ${missing.length} missing from the library`)
  for (const p of missing) console.log(`  missing   ${p.slug}  (${p.name})`)
  for (const d of duplicates) console.log(`  duplicate ${d}`)
  if (!write) {
    console.log('\nNothing written. Add --write (and optionally slugs) to copy parts in.')
    return
  }
  for (const p of chosen) {
    try {
      const def = await promote(p.slug)
      const pins = (def.headers ?? []).reduce((n, h) => n + (h.pins?.length ?? 0), 0)
      console.log(`  copied    ${p.slug}${pins ? '' : '  (no pins yet: add them before merging)'}`)
    } catch (err) {
      console.log(`  failed    ${p.slug}: ${err.message}`)
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err.message)
    process.exit(1)
  })
}
