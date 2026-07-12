import { readFileSync, readdirSync, statSync } from 'fs'
import { resolve, join } from 'path'
import type { Plugin } from 'vite'

/**
 * Vite plugin (WEB build, epic #267 / #475) that bundles the bundled Standard
 * Parts library into the browser app.
 * =============================================================================
 *
 * On the desktop, `parts.listLibraries` reads `examples/parts/snakie-standard`
 * off disk in the main process (image assets inlined as data URLs). The browser
 * has no filesystem, so this plugin reads that library at BUILD time and exposes
 * it as the virtual module `virtual:snakie-standard-parts`, whose default export
 * is a ready-to-serve `PartLibraryWithParts[]`.
 *
 * Part geometry (shapes/pins/labels) is inlined as JSON so the board view can
 * draw parts (servos etc.). Raster `image.<ext>` assets are EMITTED as normal
 * hashed build assets and referenced by URL (kept out of the JS payload — they
 * total a few MB), which an SVG `<image href>` renders under `img-src 'self'`.
 * `help.md` is inlined as `helpText` (small, powers the help panel).
 *
 * Parsing intentionally lives in the plugin (Node/build side) using the `yaml`
 * package, mirroring the desktop's `partFromYaml`/`libraryFromYaml`, so the
 * shipped data is already validated JSON and the runtime does zero YAML work.
 */

const VIRTUAL_ID = 'virtual:snakie-standard-parts'
const RESOLVED_ID = '\0' + VIRTUAL_ID
const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'svg']

interface EmittedImage {
  partId: string
  refId: string
}

export function standardPartsPlugin(): Plugin {
  const libRoot = resolve(__dirname, 'examples/parts/snakie-standard')

  return {
    name: 'snakie-standard-parts',

    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_ID
      return null
    },

    async load(id) {
      if (id !== RESOLVED_ID) return null

      // Lazy import so the plugin file itself stays cheap to load.
      const { parse } = await import('yaml')

      let manifest: Record<string, unknown> = { id: 'snakie-standard', name: 'Standard Parts' }
      try {
        manifest = parse(readFileSync(join(libRoot, 'library.yml'), 'utf-8')) as Record<string, unknown>
      } catch {
        /* synthesise from defaults */
      }
      if (!manifest.id) manifest.id = 'snakie-standard'

      const partDirs = readdirSync(libRoot).filter((name) => {
        try {
          return statSync(join(libRoot, name)).isDirectory()
        } catch {
          return false
        }
      })

      const parts: Record<string, unknown>[] = []
      const emitted: EmittedImage[] = []

      for (const partId of partDirs) {
        const partDir = join(libRoot, partId)
        let part: Record<string, unknown>
        try {
          part = parse(readFileSync(join(partDir, 'parts.yml'), 'utf-8')) as Record<string, unknown>
        } catch {
          continue // no valid parts.yml — skip (like the desktop reader)
        }
        if (!part || typeof part !== 'object') continue
        if (!part.id) part.id = partId
        if (!Array.isArray(part.headers)) part.headers = []

        // Inline help.md → helpText (small; powers the help panel).
        if (typeof part.help === 'string') {
          try {
            part.helpText = readFileSync(join(partDir, part.help as string), 'utf-8')
          } catch {
            /* missing help — ignore */
          }
        }

        // Emit the raster image (if any) as a hashed asset; reference by URL.
        if (typeof part.image === 'string' && IMAGE_EXTS.some((e) => (part.image as string).toLowerCase().endsWith('.' + e))) {
          try {
            const refId = this.emitFile({
              type: 'asset',
              name: `parts/${partId}-${part.image as string}`,
              source: readFileSync(join(partDir, part.image as string))
            })
            emitted.push({ partId, refId })
          } catch {
            /* unreadable image — part still renders from shapes */
          }
        }
        // Drop fields the board view never needs (keep the payload lean).
        delete part.drivers
        delete part.help
        parts.push(part)
      }

      // Build the module. Image URLs come from import.meta.ROLLUP_FILE_URL_<ref>
      // so they carry the final hashed, base-prefixed path.
      const urlMap = emitted
        .map((e) => `  ${JSON.stringify(e.partId)}: import.meta.ROLLUP_FILE_URL_${e.refId}`)
        .join(',\n')

      const libMeta = {
        id: manifest.id,
        name: manifest.name ?? 'Standard Parts',
        description: manifest.description,
        author: manifest.author,
        homepage: manifest.homepage,
        version: manifest.version,
        source: 'registry'
      }

      return `
const IMAGE_URLS = {
${urlMap}
}
const PARTS = ${JSON.stringify(parts)}
for (const p of PARTS) {
  const u = IMAGE_URLS[p.id]
  if (u) p.imageData = u
}
export default [{ ...${JSON.stringify(libMeta)}, parts: PARTS }]
`
    }
  }
}
