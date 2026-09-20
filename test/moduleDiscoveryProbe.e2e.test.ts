import { describe, it, expect } from 'vitest'
import { MicroPythonRuntime } from '../src/main/device/MicroPythonRuntime'
import {
  allModuleNames,
  discoverSnippet,
  moduleMembersSnippet,
  parseDiscovery,
  parseModuleMembers
} from '../src/shared/module-discovery'

/**
 * The discovery probe is GENERATED Python parsed by a hand-written parser, and
 * both halves are guesses until a real interpreter has run them (#1246, same
 * discipline as the #131 version probe).
 *
 * What only the real interpreter can prove: the snippet is accepted by
 * MicroPython's compiler (not just CPython's), `help('modules')` prints in the
 * shape the parser expects, the section fences survive, and the `dir()` probe
 * leaves `sys.modules` as it found it.
 *
 * The WASM port's module list is not an Alvik's — no port can be, in CI — so
 * these assert on what EVERY build has (`sys`, `gc`, `json`) and on the shapes
 * the parser depends on, and the vendor-specific column/slash formats are
 * covered by the transcript tests in `moduleDiscovery.test.ts`.
 */
describe('module discovery probe (real interpreter)', () => {
  it('enumerates the built-in modules, the filesystem and the firmware identity', async () => {
    const rt = new MicroPythonRuntime()
    await rt.init(() => {})
    try {
      // A file module on `sys.path` that `help('modules')` will NOT list — the
      // whole reason the probe walks the filesystem as well.
      await rt.runCaptured(
        [
          'import os, sys',
          "try: os.mkdir('/lib')",
          'except OSError: pass',
          "f = open('/lib/snakie_probe_fixture.py', 'w')",
          "f.write('VALUE = 1\\n')",
          'f.close()',
          "if '/lib' not in sys.path: sys.path.append('/lib')"
        ].join('\n')
      )

      const found = parseDiscovery(await rt.runCaptured(discoverSnippet()))

      // Built in: every MicroPython build has these, and they come from
      // `help('modules')` rather than from any file.
      expect(found.frozen).toContain('sys')
      expect(found.frozen).toContain('gc')
      // The prose trailer must not have become five modules.
      expect(found.frozen).not.toContain('Plus')
      expect(found.frozen).not.toContain('filesystem')

      // On the filesystem, and invisible to `help('modules')`.
      expect(found.filesystem).toContain('snakie_probe_fixture')
      expect(found.frozen).not.toContain('snakie_probe_fixture')

      // Live in the session, and the search path the board really uses.
      // (`sys` itself is a builtin the port does not list in `sys.modules`,
      // which is exactly why `imported` is a third source and not the only one.)
      expect(found.imported).toContain('os')
      expect(found.searchPath).toContain('/lib')

      // Who the board says it is. WHICH fields arrive is port-dependent — this
      // build has no `os.uname()` at all and identifies itself purely through
      // `sys.implementation`, which is why every field is optional and every
      // read individually wrapped.
      expect(found.firmware.implementation).toBe('micropython')
      expect(found.firmware.implMachine ?? found.firmware.sysname).toBeTruthy()

      // The union is what the panels list.
      const all = allModuleNames(found)
      expect(all).toContain('snakie_probe_fixture')
      expect(all).toContain('gc')
    } finally {
      rt.dispose()
    }
  }, 30000)

  it('reads one module with dir(), and puts it back', async () => {
    const rt = new MicroPythonRuntime()
    await rt.init(() => {})
    try {
      const members = parseModuleMembers(await rt.runCaptured(moduleMembersSnippet('json')))
      expect(members).toContain('dumps')
      expect(members).toContain('loads')
      // Dunders are filtered ON THE BOARD, to keep the transfer small.
      expect(members.some((m) => m.startsWith('__'))).toBe(false)

      // And the import is undone: a listing must not leave the learner's
      // session (or its memory) changed behind their back.
      const after = await rt.runCaptured("import sys\nprint('json' in sys.modules)")
      expect(after).toContain('False')
    } finally {
      rt.dispose()
    }
  }, 30000)

  it('a module the board does not have yields nothing, never an error', async () => {
    const rt = new MicroPythonRuntime()
    await rt.init(() => {})
    try {
      const out = await rt.runCaptured(moduleMembersSnippet('snakie_no_such_module'))
      expect(parseModuleMembers(out)).toEqual([])
      expect(out).not.toContain('Traceback')
    } finally {
      rt.dispose()
    }
  }, 30000)
})
