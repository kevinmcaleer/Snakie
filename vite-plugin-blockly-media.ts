import { createReadStream, existsSync, readFileSync, readdirSync } from 'fs'
import { createRequire } from 'module'
import { dirname, extname, join, resolve } from 'path'
import type { Plugin } from 'vite'

/**
 * Vite plugin (#1009, epic #1007) that serves Blockly's media locally.
 * =============================================================================
 *
 * Blockly's trashcan, zoom controls, dropdown arrows and warning icons are
 * images it fetches at runtime from `pathToMedia`, which defaults to a CDN
 * (`https://static.blockly.com/media/`). That default is wrong for Snakie twice
 * over:
 *
 *  - **The app's CSP is `img-src 'self' data:`**, so every one of those requests
 *    is refused and the canvas renders with no trashcan and no zoom buttons.
 *  - **A classroom is often offline**, and an app that needs a CDN to show its
 *    delete button is not an app you can install on a cart of Chromebooks and
 *    take to a school with a firewall (epic #267).
 *
 * So the media ships with us. The files are read from the INSTALLED `blockly`
 * package rather than vendored into the repo, which is what keeps them from
 * drifting out of step with the version in `package.json` on the first upgrade.
 * They are emitted under a fixed, unhashed `blockly-media/` directory because
 * `pathToMedia` is a directory PREFIX that Blockly concatenates filenames onto —
 * a hashed asset name has nowhere to go in that scheme.
 *
 * The canvas sets `media: 'blockly-media/'` — RELATIVE, so it resolves against
 * the document in both hosts: `file://…/out/renderer/index.html` in the packaged
 * desktop app, and the site root on the web.
 *
 * Audio is skipped: the workspace is injected with `sounds: false` (a click
 * noise per block placement is not what a room of thirty children needs), so
 * shipping the `.mp3`s would be shipping bytes nothing can play.
 */

/** Where the built/served files live, relative to the renderer root. */
export const BLOCKLY_MEDIA_DIR = 'blockly-media'

/** Extensions worth shipping — images and cursors; see the note on audio above. */
const KEEP = new Set(['.svg', '.png', '.gif', '.cur'])

const MIME: Record<string, string> = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.cur': 'image/vnd.microsoft.icon'
}

function resolveMediaDir(): string {
  try {
    return resolve(
      dirname(createRequire(join(__dirname, 'x.js')).resolve('blockly/package.json')),
      'media'
    )
  } catch {
    return resolve(__dirname, 'node_modules/blockly/media')
  }
}

export function blocklyMediaPlugin(): Plugin {
  // Resolved from the package itself, so this follows an upgrade automatically.
  //
  // `createRequire` rather than a bare `require.resolve`: Vite bundles a `.ts`
  // config to ESM before running it, where `require` does not exist. The flat
  // `node_modules` path is the fallback for a layout the resolver can't see —
  // it is what this repo has, and being wrong there only costs the sprites.
  const mediaDir = resolveMediaDir()

  const files = (): string[] =>
    existsSync(mediaDir) ? readdirSync(mediaDir).filter((f) => KEEP.has(extname(f))) : []

  return {
    name: 'snakie-blockly-media',

    // `npm run dev` / `dev:web` — serve straight out of node_modules.
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split('?')[0] ?? ''
        const hit = url.match(new RegExp(`/${BLOCKLY_MEDIA_DIR}/([\\w.-]+)$`))
        const name = hit?.[1]
        if (!name || !files().includes(name)) return next()
        res.setHeader('Content-Type', MIME[extname(name)] ?? 'application/octet-stream')
        createReadStream(join(mediaDir, name)).pipe(res)
      })
    },

    // Both production builds — emit at a fixed name so the prefix stays a prefix.
    generateBundle() {
      for (const name of files()) {
        this.emitFile({
          type: 'asset',
          fileName: `${BLOCKLY_MEDIA_DIR}/${name}`,
          source: readFileSync(join(mediaDir, name))
        })
      }
    }
  }
}
