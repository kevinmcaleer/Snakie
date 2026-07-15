import { describe, it, expect } from 'vitest'
import { MicroPythonRuntime } from '../src/main/device/MicroPythonRuntime'
import { buildVersionProbe, parseVersionProbe } from '../src/renderer/src/lib/board-packages'

/** The version probe is GENERATED Python — run it on the real interpreter (#131). */
describe('board-packages version probe (real interpreter)', () => {
  it('reads __version__ from /lib files without importing them', async () => {
    const rt = new MicroPythonRuntime()
    await rt.init(() => {})
    try {
      // Seed /lib with a file module (with a version + a side-effect tripwire)
      // and a dir package. If the probe IMPORTED the module, the tripwire would
      // change the output.
      await rt.runCaptured(
        [
          "import os",
          "try: os.mkdir('/lib')",
          "except OSError: pass",
          "try: os.mkdir('/lib/umod')",
          "except OSError: pass",
          "f=open('/lib/servo.py','w')",
          'f.write(\'__version__ = "2.1.0"\\nraise RuntimeError("imported!")\\n\')',
          "f.close()",
          "f=open('/lib/umod/__init__.py','w')",
          'f.write(\'__version__ = "0.9"\\n\')',
          "f.close()"
        ].join('\n')
      )
      const probe = buildVersionProbe([
        { name: 'servo', path: '/lib/servo.py', isDir: false },
        { name: 'umod', path: '/lib/umod', isDir: true },
        { name: 'ghost', path: '/lib/ghost.py', isDir: false } // missing file → skipped
      ])
      const out = await rt.runCaptured(probe)
      expect(parseVersionProbe(out)).toEqual({ servo: '2.1.0', umod: '0.9' })
    } finally {
      rt.dispose()
    }
  }, 30000)
})
