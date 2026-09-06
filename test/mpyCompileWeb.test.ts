import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseMpy } from '../src/shared/mpy-info'
import {
  baseNameOf,
  compileErrorMessage,
  compileWithFactory,
  isCompilable,
  mpyPathFor,
  type MpyCrossFactory
} from '../src/shared/mpy-compile'
import { webConnectSrc } from '../src/renderer/src/web/web-hosts'

/**
 * Compiling `.py` to `.mpy` IN THE BROWSER (#970).
 *
 * On app.snakie.org the menu item read "Compile to .mpy (unavailable)" — not
 * because a page cannot run the compiler (it is WebAssembly; Pybricks runs the
 * same one client-side) but because it was only ever wired to the Electron main
 * process. So the compiler is now built twice from the same objects — a `.cjs`
 * for node and an ES module for the browser — and the RUN in between is one
 * shared function both platforms call.
 *
 * The artifacts are committed, so these tests do the real thing rather than
 * mocking it: they compile through the browser loader and check it agrees with
 * the desktop one byte for byte. If the two ever separate, a student's `.mpy`
 * would differ depending on which app they used, which is exactly the drift
 * worth failing a build over.
 */

const DIR = 'resources/mpy-cross'
const require_ = createRequire(import.meta.url)

/** The node loader, as `main/mpy/compile.ts` loads it. */
function nodeFactory(): MpyCrossFactory {
  return require_(join(process.cwd(), DIR, 'mpy-cross.cjs')) as MpyCrossFactory
}

/**
 * The browser loader, as `web/mpy.worker.ts` imports it.
 *
 * It is linked `-sENVIRONMENT=web,worker`, so node is not one of the
 * environments it detects — but every path that would need one is behind
 * `wasmBinary`, which we supply, so it runs here as well as it runs on a page.
 * That is the whole point: same module, same bytes.
 */
async function webFactory(): Promise<MpyCrossFactory> {
  const url = pathToFileURL(join(process.cwd(), DIR, 'mpy-cross.mjs')).href
  const mod = (await import(/* @vite-ignore */ url)) as { default: MpyCrossFactory }
  return mod.default
}

const wasm = (): Uint8Array => readFileSync(join(DIR, 'mpy-cross.wasm'))

describe('the compiler ships for the browser as well as the desktop', () => {
  it('has a loader for each environment and ONE wasm for both', () => {
    // The WebAssembly is environment-agnostic; only Emscripten's JS glue is not.
    expect(existsSync(join(DIR, 'mpy-cross.cjs'))).toBe(true)
    expect(existsSync(join(DIR, 'mpy-cross.mjs'))).toBe(true)
    expect(existsSync(join(DIR, 'mpy-cross.wasm'))).toBe(true)
    // A second `.wasm` would mean the two loaders had drifted apart.
    expect(existsSync(join(DIR, 'mpy-cross.web.wasm'))).toBe(false)
  })

  it('gives the browser an ES MODULE, because a page cannot `require`', () => {
    // The mirror of why the node loader has to be `.cjs`: there, `module` is
    // what the export line looks for; here, `import` is the only way in.
    const mjs = readFileSync(join(DIR, 'mpy-cross.mjs'), 'utf8')
    expect(mjs).toContain('export default MpyCross')
    expect(readFileSync(join(DIR, 'mpy-cross.cjs'), 'utf8')).toContain('module.exports')
  })

  it('links the node branches OUT of the browser loader', () => {
    // `-sENVIRONMENT=web,worker`. Without it the artifact still carries
    // `require("node:fs")` for an environment it will never be in, and every
    // bundler that meets it has to be told to leave it alone.
    const mjs = readFileSync(join(DIR, 'mpy-cross.mjs'), 'utf8')
    expect(mjs).not.toContain('require(')
    expect(mjs).not.toContain('__dirname')
  })

  it('builds both from the same objects, in one script', () => {
    const sh = readFileSync('scripts/build-mpy-cross.sh', 'utf8')
    expect(sh).toContain('PROG=mpy-cross.js')
    expect(sh).toContain('PROG=mpy-cross.mjs')
    expect(sh).toContain('-sENVIRONMENT=web,worker')
    expect(sh).toContain('-sEXPORT_ES6=1')
    // Both links need the same pruned incoming API, so it is written once.
    expect(sh).toContain('INCOMING_MODULE_JS_API=wasmBinary,arguments,preRun,print,printErr,onExit')
    expect(sh).toContain('cp "$WORK/micropython/mpy-cross/build/mpy-cross.mjs"')
  })
})

describe('the two loaders are the same compiler', () => {
  const src = 'def blink(pin=25, times=3):\n    return pin * times\n'

  it('compiles through the BROWSER loader', async () => {
    const r = await compileWithFactory(await webFactory(), wasm(), 'demo.py', src)
    expect(r.status, r.stderr).toBe(0)
    expect(r.mpy).toBeTruthy()

    // Our compiler out, our own parser in — the round trip that decides whether
    // a compiled file is readable in the Bytecode view.
    const info = parseMpy(r.mpy!)
    expect(info.flavour).toBe('micropython')
    expect(info.version).toBe(6)
    expect(info.arch).toBe('none')
    expect(info.sourceName).toBe('demo.py')
  })

  it('produces byte-identical bytecode from either loader', async () => {
    const [web, node] = await Promise.all([
      compileWithFactory(await webFactory(), wasm(), 'demo.py', src),
      compileWithFactory(nodeFactory(), wasm(), 'demo.py', src)
    ])
    expect(web.status).toBe(0)
    expect(node.status).toBe(0)
    // Same tag, same objects, same `.wasm` — so the browser must not be quietly
    // handing students a different file from the desktop app.
    expect(Array.from(web.mpy!)).toEqual(Array.from(node.mpy!))
  })

  it('reports a syntax error from the browser loader with the line', async () => {
    const r = await compileWithFactory(await webFactory(), wasm(), 'bad.py', 'def broken(\n  print("x")\n')
    expect(r.status).not.toBe(0)
    expect(r.mpy).toBeNull()
    // The compiler diagnoses the file the same way whichever loader ran it: the
    // traceback names the line, and the last line — the one the user is shown —
    // is the complaint itself.
    expect(r.stderr).toContain('line 2')
    expect(compileErrorMessage(r)).toBe('SyntaxError: invalid syntax')
  })
})

describe('the wiring lives in exactly one place', () => {
  const shared = readFileSync('src/shared/mpy-compile.ts', 'utf8')
  const main = readFileSync('src/main/mpy/compile.ts', 'utf8')
  const worker = readFileSync('src/renderer/src/web/mpy.worker.ts', 'utf8')

  it('has both platforms drive the compiler through the shared function', () => {
    for (const [name, src] of [
      ['main', main],
      ['worker', worker]
    ] as const) {
      expect(src, `${name} imports the shared core`).toContain('compileWithFactory')
      // A second copy of the Emscripten glue is how the two would drift: the
      // preRun-argument trap and the bare-filename rule are fixed once, here.
      expect(src, `${name} has no preRun of its own`).not.toContain('preRun:')
    }
    expect(shared).toContain('preRun: [')
  })

  it('keeps the shared core free of node, electron and the DOM', () => {
    // It compiles into the main bundle, the renderer bundle AND a web worker.
    for (const forbidden of ["from 'fs'", "from 'path'", "from 'electron'", 'document.', 'window.']) {
      expect(shared, `shared core must not use ${forbidden}`).not.toContain(forbidden)
    }
  })

  it('still writes a BARE filename, because the in-memory FS starts empty', () => {
    // `sub/foo.py` fails on the missing directory rather than compiling.
    expect(main).toContain('compileSource(basename(pyPath)')
    expect(readFileSync('src/renderer/src/web/web-mpy.ts', 'utf8')).toContain(
      'worker.compile(baseNameOf(path)'
    )
  })
})

describe('the web build answers the same two calls', () => {
  const install = readFileSync('src/renderer/src/web/install-web-api.ts', 'utf8')
  const api = readFileSync('src/renderer/src/web/web-mpy.ts', 'utf8')
  const worker = readFileSync('src/renderer/src/web/mpy.worker.ts', 'utf8')
  const tree = readFileSync('src/renderer/src/components/LocalFileTree.tsx', 'utf8')

  it('installs an `mpy` namespace over the no-op fallback', () => {
    // Without this `window.api.mpy` is the fallback's deep stub, `available()`
    // resolves `[]`, and the menu item greys out — which is all #970 was.
    expect(install).toContain('createWebMpyApi')
    expect(install).toContain('w.api.mpy =')
  })

  it('exposes exactly what the menu item calls', () => {
    // The preload bridge's contract: `available()` for the label, `compile()`
    // for the action. The tree is untouched by #970 and must stay that way.
    expect(api).toContain('available: async ()')
    expect(api).toContain('compile: async (path: string)')
    expect(tree).toContain('window.api.mpy')
    expect(tree).toContain('window.api.mpy.compile(entry.path)')
  })

  it('writes the `.mpy` as BYTES, never as text', () => {
    // A `.mpy` down the text channel comes back as U+FFFD replacement
    // characters, unrecoverably (#959) — the same trap the uploader hit.
    expect(api).toContain('fs.writeFileBytes(out, result.mpy)')
    expect(api).not.toContain('fs.writeFile(')
  })

  it('runs the compile in a WORKER, not on the page', () => {
    // mpy-cross runs synchronously to completion inside one WASM call, with no
    // yield for the browser to paint. The sim learned this the expensive way.
    expect(api).toContain("new Worker(new URL('./mpy.worker.ts', import.meta.url), { type: 'module' })")
    expect(worker).toContain('self.onmessage')
  })

  it('hands the wasm in as `wasmBinary` from a static asset', () => {
    // No `locateFile` shim needed, and no guessing at a hashed asset path: the
    // `?url` import IS the built asset's URL.
    expect(worker).toContain("mpy-cross.wasm?url'")
    expect(worker).toContain('await wasmBinary()')
    // Same-origin, so the page's own CSP has to allow it.
    expect(webConnectSrc()).toContain("connect-src 'self'")
  })
})

describe('the path helpers hold on every platform', () => {
  it('puts the `.mpy` beside its source, whatever the separator', () => {
    expect(mpyPathFor('Projects/main.py')).toBe('Projects/main.mpy')
    expect(mpyPathFor('C:\\Users\\kev\\main.py')).toBe('C:\\Users\\kev\\main.mpy')
    // A web-fs token is a path too — a loose file keeps its token shape.
    expect(mpyPathFor('loose://3/sketch.py')).toBe('loose://3/sketch.mpy')
    // Case-insensitive, and only the EXTENSION: `pyplot.py` is not `plot.mpy`.
    expect(mpyPathFor('a/Thing.PY')).toBe('a/Thing.mpy')
    expect(mpyPathFor('a/pyplot.py')).toBe('a/pyplot.mpy')
  })

  it('offers itself only on Python files', () => {
    expect(isCompilable('main.py')).toBe(true)
    expect(isCompilable('MAIN.PY')).toBe(true)
    expect(isCompilable('main.mpy')).toBe(false)
    expect(isCompilable('notes.txt')).toBe(false)
    expect(isCompilable('py')).toBe(false)
  })

  it('takes the bare name off either separator', () => {
    expect(baseNameOf('Projects/lib/servo.py')).toBe('servo.py')
    expect(baseNameOf('C:\\p\\servo.py')).toBe('servo.py')
    expect(baseNameOf('servo.py')).toBe('servo.py')
  })

  it('shows the LAST line of the traceback, which is the complaint', () => {
    expect(
      compileErrorMessage({
        status: 1,
        mpy: null,
        stderr: 'Traceback (most recent call last):\n  File "x.py"\nSyntaxError: invalid syntax\n'
      })
    ).toBe('SyntaxError: invalid syntax')
    // Nothing said at all still has to read as a sentence, not as `undefined`.
    expect(compileErrorMessage({ status: 3, mpy: null, stderr: '' })).toBe('mpy-cross exited 3')
  })
})
