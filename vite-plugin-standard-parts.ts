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
 * `help.md` is inlined as `helpText` (small, powers the help panel), and a
 * part's `blocks.yml` as `blocksYaml` (#1017) so the web palette gets the same
 * part-contributed blocks the desktop does. A part's `mesh:` (STL/DAE) is
 * emitted the same way as the images and exported as `meshUrls`, so the web
 * build can copy a part's real 3-D model into a project.
 *
 * Parsing intentionally lives in the plugin (Node/build side) using the `yaml`
 * package, mirroring the desktop's `partFromYaml`/`libraryFromYaml`, so the
 * shipped data is already validated JSON and the runtime does zero YAML work.
 */

const VIRTUAL_ID = 'virtual:snakie-standard-parts'
const RESOLVED_ID = '\0' + VIRTUAL_ID
const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'svg']
/** The model formats a part's `mesh:` may name (matches the desktop's MESH_EXTENSIONS). */
const MESH_EXTS = ['stl', 'dae']

interface EmittedImage {
  partId: string
  refId: string
}

/** A part's 3-D model, emitted as its own asset and keyed `<partId>/<mesh>`. */
interface EmittedMesh {
  key: string
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
      const emittedMeshes: EmittedMesh[] = []
      // Driver file contents keyed `<partId>/<source>`, served by the web
      // readDriverSource so the "install driver" banner works (e.g. sg90 → servo.py).
      //
      // BASE64, not utf-8 (#959). A part may ship a `.mpy` driver — the SAM
      // part's `sam_render.mpy` is one — and reading it as text here corrupts it
      // before the web build even ships, which is the same mistake as the
      // runtime one but baked into the bundle. Base64 carries any bytes; the web
      // reader decodes it, to text or to bytes, depending on what is asked for.
      const driverSources: Record<string, string> = {}

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

        // Blocks the part ships (#1017). Inlined as raw text, exactly as the
        // desktop reader hands it over, so the renderer runs one parser in one
        // place whichever host it is in.
        try {
          const blocks = readFileSync(join(partDir, 'blocks.yml'), 'utf-8')
          if (blocks.trim()) part.blocksYaml = blocks
        } catch {
          /* no blocks.yml — the part's blocks are derived instead */
        }

        // Bundle each declared driver file's source (a bundled filename, not a
        // `mip:` spec or URL) so readDriverSource can serve it on the web.
        if (Array.isArray(part.drivers)) {
          for (const d of part.drivers as { source?: string }[]) {
            const src = d?.source
            if (typeof src === 'string' && !src.includes(':') && !src.startsWith('http')) {
              try {
                driverSources[`${partId}/${src}`] = readFileSync(join(partDir, src)).toString(
                  'base64'
                )
              } catch {
                /* unreadable driver — install will report it can't be read */
              }
            }
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
        // Emit the part's 3-D model as a hashed asset too, so "Add to Build" and
        // "Upgrade to mesh" can copy it into a web project. Like the images it
        // stays OUT of the JS payload (the library's models total ~7 MB): the
        // browser fetches one only when a part that uses it lands in Build, and
        // the service worker's runtime cache keeps it for offline use after.
        const mesh = typeof part.mesh === 'string' ? (part.mesh as string).trim() : ''
        const meshExt = mesh.slice(mesh.lastIndexOf('.') + 1).toLowerCase()
        if (mesh && MESH_EXTS.includes(meshExt) && !mesh.includes('..') && !/^[/\\]/.test(mesh)) {
          try {
            const base = mesh.split(/[/\\]/).pop() as string
            const refId = this.emitFile({
              type: 'asset',
              name: `parts/${partId}-${base}`,
              source: readFileSync(join(partDir, mesh))
            })
            emittedMeshes.push({ key: `${partId}/${mesh}`, refId })
          } catch {
            /* unreadable model — the part falls back to its footprint box */
          }
        }
        delete part.help // helpText carries it now
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

      const meshMap = emittedMeshes
        .map((e) => `  ${JSON.stringify(e.key)}: import.meta.ROLLUP_FILE_URL_${e.refId}`)
        .join(',\n')

      return `
const IMAGE_URLS = {
${urlMap}
}
export const meshUrls = {
${meshMap}
}
const PARTS = ${JSON.stringify(parts)}
for (const p of PARTS) {
  const u = IMAGE_URLS[p.id]
  if (u) p.imageData = u
}
export const driverSources = ${JSON.stringify(driverSources)}
export default [{ ...${JSON.stringify(libMeta)}, parts: PARTS }]
`
    }
  }
}
