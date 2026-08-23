/**
 * The engine must stay portable (epic #634 §2.1, acceptance criterion 5).
 *
 * The whole reason the refactoring engine lives in `src/shared/` rather than
 * behind the Python plugin host is that it has to work in two places the host
 * cannot reach:
 *
 * - **With no Python installed** — which is most Windows users and every school
 *   laptop. `PluginHost` shells out to the user's `python3`; a Python-side
 *   engine would ship zero refactorings to them.
 * - **In Snakie for Web (#267)** — the classroom build has no plugin host at
 *   all, so a host-side engine would ship zero refactorings to exactly the
 *   audience that needs them most.
 *
 * That property is easy to state and easy to break with one convenient import,
 * so this suite guards it structurally rather than trusting review.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative, resolve } from 'path'
import { createContext, detectAll, applyOffer } from '../src/shared/refactor/engine'
import { ALL_RULES } from '../src/shared/refactor/rules'

const ENGINE_DIR = resolve(__dirname, '../src/shared/refactor')

/** Every `.ts` file in the engine, recursively. */
function engineFiles(dir = ENGINE_DIR): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...engineFiles(path))
    else if (name.endsWith('.ts')) out.push(path)
  }
  return out
}

/** Module specifiers a file imports. */
function importsOf(src: string): string[] {
  const out: string[] = []
  const re = /(?:^|\s)(?:import|export)[\s\S]*?from\s+['"]([^'"]+)['"]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src)) != null) out.push(m[1])
  const bare = /(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g
  while ((m = bare.exec(src)) != null) out.push(m[1])
  return out
}

const FILES = engineFiles()

describe('refactoring engine portability (#634 §2.1)', () => {
  it('has files to check', () => {
    expect(FILES.length).toBeGreaterThan(10)
  })

  it('never reaches into the Electron main process or the renderer', () => {
    const offenders: string[] = []
    for (const file of FILES) {
      for (const spec of importsOf(readFileSync(file, 'utf8'))) {
        if (/(^|\/)(main|renderer|preload)\//.test(spec)) {
          offenders.push(`${relative(ENGINE_DIR, file)} imports ${spec}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('never imports Electron, Monaco, React or a node builtin', () => {
    // A node builtin would break the browser build; Monaco/Electron would break
    // both the web build and the tests.
    const banned = [
      'electron',
      'monaco-editor',
      'react',
      'react-dom',
      'fs',
      'path',
      'os',
      'child_process',
      'node:fs',
      'node:path',
      'node:os',
      'node:child_process',
      'serialport',
      'worker_threads'
    ]
    const offenders: string[] = []
    for (const file of FILES) {
      for (const spec of importsOf(readFileSync(file, 'utf8'))) {
        if (banned.includes(spec) || spec.startsWith('monaco-editor/')) {
          offenders.push(`${relative(ENGINE_DIR, file)} imports ${spec}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('imports nothing outside src/shared at all', () => {
    const offenders: string[] = []
    for (const file of FILES) {
      for (const spec of importsOf(readFileSync(file, 'utf8'))) {
        if (!spec.startsWith('.')) {
          offenders.push(`${relative(ENGINE_DIR, file)} imports the package ${spec}`)
          continue
        }
        const resolved = resolve(join(file, '..'), spec)
        if (!resolved.startsWith(resolve(__dirname, '../src/shared'))) {
          offenders.push(`${relative(ENGINE_DIR, file)} escapes src/shared via ${spec}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('touches no browser or node global at run time', () => {
    // `window`/`document`/`process` would each break one of the three hosts.
    const offenders: string[] = []
    for (const file of FILES) {
      const src = readFileSync(file, 'utf8')
        // Comments legitimately discuss the renderer and the window.
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|\s)\/\/.*$/gm, '')
      for (const token of [/\bwindow\./, /\bdocument\./, /\bprocess\./, /\brequire\(/, /\blocalStorage\b/]) {
        if (token.test(src)) offenders.push(`${relative(ENGINE_DIR, file)} uses ${token}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('runs a real refactoring with nothing but a source string', () => {
    // The end-to-end proof: no Electron, no Monaco, no device, no Python.
    const src = 'def read(bus):\n    if bus is not None:\n        raw = bus.read()\n        return raw\n'
    const ctx = createContext(src)
    expect(ctx).not.toBeNull()
    const offers = detectAll(ctx!, ALL_RULES)
    expect(offers.length).toBeGreaterThan(0)
    const applied = applyOffer(offers.find((o) => o.rule.id === 'guard-clause')!, ctx!)
    expect(applied?.result).toContain('if bus is None:')
  })

  it('offers board-gated rules nothing to do when no board is connected', () => {
    // The web build with no hardware is the common classroom case; it must not
    // be told to add an inline assembler.
    const src = 'def hot():\n    total = 0\n    for i in range(10):\n        total += i\n    return total\n'
    const ctx = createContext(src)!
    const gated = new Set(ALL_RULES.filter((r) => r.requires).map((r) => r.id))
    expect(detectAll(ctx, ALL_RULES).filter((o) => gated.has(o.rule.id))).toEqual([])
  })
})
