import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { parseMpy } from '../src/shared/mpy-info'
import { compileWithFactory, type CompileOutput, type MpyCrossFactory } from '../src/shared/mpy-compile'

/**
 * Compiling `.py` to `.mpy` with our own compiler (#949, built by #950).
 *
 * The compiler is `mpy-cross` from a pinned MicroPython tag, built to
 * WebAssembly by `scripts/build-mpy-cross.sh` and committed under
 * `resources/mpy-cross`. Because the artifact ships in the repo, this test can
 * do the real thing rather than mock it: compile source, then read the result
 * back with Snakie's OWN `.mpy` parser. If the two ever disagree — a compiler
 * emitting a format the Bytecode view cannot read — that is a bug the user
 * would meet as an unreadable file, and it fails here first.
 *
 * `main/mpy/compile.ts` itself imports `electron`, which is not available in a
 * node test run — but since #970 the part worth testing is not in it: the run
 * itself lives in `shared/mpy-compile.ts`, which both the desktop app and the
 * browser call, so this drives the SHIPPING code rather than a copy of it. Only
 * the loader is local here. The wiring is the thing under test either way:
 * Emscripten hands the module to `preRun` as an ARGUMENT rather than as `this`,
 * and its in-memory filesystem starts EMPTY, so a path with a directory in it
 * fails to write. Both cost real time to discover and are easy to undo by
 * accident.
 *
 * The BROWSER half of the same compiler — its ES-module loader, and the proof
 * that both loaders emit identical bytecode — is `mpyCompileWeb.test.ts`.
 */

const DIR = 'resources/mpy-cross'
const require_ = createRequire(import.meta.url)

/** Drive the bundled compiler over one source string, the way main does. */
function compile(name: string, source: string): Promise<CompileOutput> {
  const factory = require_(join(process.cwd(), DIR, 'mpy-cross.cjs')) as MpyCrossFactory
  const wasmBinary = readFileSync(join(DIR, 'mpy-cross.wasm'))
  return compileWithFactory(factory, wasmBinary, name, source)
}

describe('the compiler ships with the app', () => {
  it('has both halves — the loader and the wasm', () => {
    // A missing `.wasm` is the one failure the loader cannot report usefully:
    // it aborts inside Emscripten rather than returning an error.
    expect(existsSync(join(DIR, 'mpy-cross.cjs'))).toBe(true)
    expect(existsSync(join(DIR, 'mpy-cross.wasm'))).toBe(true)
  })

  it('names the loader `.cjs`, or `require` hands back an empty object', () => {
    // Emscripten's export line is guarded by `typeof module === 'object'`. This
    // package.json is `"type": "module"`, so a `.js` here is parsed as ESM, that
    // branch never runs, and the factory arrives as `{}` — which fails as
    // "factory is not a function", nowhere near the actual cause. The preload
    // has to be `index.cjs` for exactly this reason (CLAUDE.md).
    expect(existsSync(join(DIR, 'mpy-cross.cjs'))).toBe(true)
    expect(existsSync(join(DIR, 'mpy-cross.js'))).toBe(false)
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
    expect(pkg.type, 'the reason .cjs is required').toBe('module')
    expect(readFileSync('scripts/build-mpy-cross.sh', 'utf8')).toContain('mpy-cross.cjs')
  })

  it('records which MicroPython built it', () => {
    // Committed binaries with no provenance are the ones nobody dares rebuild.
    const meta = JSON.parse(readFileSync(join(DIR, 'BUILD.json'), 'utf8'))
    expect(meta.micropython).toMatch(/^v\d+\.\d+/)
    expect(meta.emsdk).toContain('emscripten')
  })

  it('is built from the same MicroPython the Board Finder offers', () => {
    // The reason for owning this build rather than taking the published
    // package: that one is pinned to v1.19 by a hand-written source list, and
    // a compiler older than the firmware we hand people is exactly the drift
    // worth not having. If these ever separate, re-run the build script with
    // MICROPYTHON_TAG set to match.
    const compiler = JSON.parse(readFileSync(join(DIR, 'BUILD.json'), 'utf8')).micropython
    const boards = JSON.parse(readFileSync('src/renderer/public/boards/boards.json', 'utf8'))
    expect(compiler, `compiler ${compiler} vs board index ${boards.micropython}`).toBe(
      boards.micropython
    )
  })

  it('is packaged for the built app, not just present in the repo', () => {
    // It is read by PATH at runtime, so it has to be a real file in resources/.
    const yml = readFileSync('electron-builder.yml', 'utf8')
    expect(yml).toContain('from: resources/mpy-cross')
    expect(yml).toContain('to: mpy-cross')
  })
})

describe('it actually compiles', () => {
  it('turns Python into bytecode Snakie itself can read', async () => {
    const r = await compile('demo.py', 'def blink(pin=25, times=3):\n    return pin * times\n')
    expect(r.status, r.stderr).toBe(0)
    expect(r.mpy).toBeTruthy()

    // The round trip that matters: our compiler out, our parser in.
    const info = parseMpy(r.mpy!)
    expect(info.flavour).toBe('micropython')
    expect(info.version).toBe(6)
    expect(info.arch).toBe('none')          // portable bytecode, not machine code
    expect(info.hasNativeCode).toBe(false)
    expect(info.sourceName).toBe('demo.py')
  })

  it('handles the syntax people actually write', async () => {
    const src = [
      'import asyncio',
      'class R:',
      '    def __init__(self, n: str, s: float = 1.0) -> None:',
      '        self.n, self.s = n, s',
      '    async def go(self, ms: int):',
      '        await asyncio.sleep_ms(ms)',
      '        return f"{self.n} at {self.s:.1f}"',
      'x = [i * 2 for i in range(3) if i]',
      ''
    ].join('\n')
    const r = await compile('modern.py', src)
    expect(r.status, r.stderr).toBe(0)
    expect(parseMpy(r.mpy!).version).toBe(6)
  })

  it('reports a syntax error with the line, not just a failure', async () => {
    // The whole value of surfacing mpy-cross's own words: it names the line, and
    // anything vaguer sends the reader back to guess at their own file.
    const r = await compile('bad.py', 'def broken(\n    print("oops")\n')
    expect(r.status).not.toBe(0)
    expect(r.mpy).toBeNull()
    expect(r.stderr).toContain('SyntaxError')
    expect(r.stderr).toContain('line 2')
  })
})

describe('the two Emscripten traps stay fixed', () => {
  // Both traps live in the shared core since #970, so fixing them once fixes
  // them for the desktop app and the browser alike.
  const src = readFileSync('src/shared/mpy-compile.ts', 'utf8')

  it('takes the module from preRun’s ARGUMENT, not from `this`', () => {
    // `callRuntimeCallbacks` invokes `callback(Module)`. Using `this` throws
    // inside the runtime, before any of our error handling can say why.
    expect(src).toMatch(/preRun: \[\s*\(m\) => \{/)
    expect(src).not.toMatch(/preRun:.*this\.FS/s)
  })

  it('writes a BARE filename, because the in-memory filesystem starts empty', () => {
    // `dir/foo.py` fails on the missing directory rather than compiling.
    expect(readFileSync('src/main/mpy/compile.ts', 'utf8')).toContain(
      'compileSource(basename(pyPath)'
    )
  })
})

describe('what the menu item will and will not claim', () => {
  const tree = readFileSync('src/renderer/src/components/LocalFileTree.tsx', 'utf8')

  it('offers itself only on Python files', () => {
    expect(tree).toContain('if (isPy(target.name)) {')
  })

  it('says it is unavailable rather than failing when pressed', () => {
    // Both platforms can compile since #970, so this is now the honest report of
    // a build without the artifact, or a browser with no filesystem to write
    // the `.mpy` into — never a silent failure on the press.
    expect(tree).toContain("'Compile to .mpy (unavailable)'")
    expect(tree).toContain('disabled: !mpyReady')
  })

  it('does not claim the board will run it', () => {
    // MicroPython imports foo.py in PREFERENCE to foo.mpy, so a board carrying
    // both goes on running the source. The message says what happened — it
    // compiled, and how big — and promises nothing about the device.
    const fn = tree.slice(tree.indexOf('const compileToMpy'), tree.indexOf('const closeMenu'))
    expect(fn).toContain('Compiled ${')
    for (const overclaim of ['uploaded', 'on the board', 'deployed', 'installed']) {
      expect(fn.toLowerCase()).not.toContain(overclaim)
    }
  })
})
