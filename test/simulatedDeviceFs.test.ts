import { describe, it, expect } from 'vitest'
import { SimulatedDevice } from '../src/main/device/SimulatedDevice'

/**
 * Integration test for the simulated device's REAL filesystem (#135): files
 * written through the device API land in the interpreter's in-memory VFS, so
 * they persist, list, read back, and are IMPORTABLE — the `import instruments`
 * scenario (`/lib` is on MicroPython's sys.path). Uses the real WebAssembly
 * runtime, hence the generous timeouts.
 */
describe('SimulatedDevice filesystem (real VFS)', () => {
  it('writes, lists, reads and stats files in the interpreter VFS', async () => {
    const dev = new SimulatedDevice()
    await dev.connect()
    try {
      await dev.mkdir('/lib')
      await dev.writeFile('/lib/mymod.py', 'VALUE = 7\n')

      const lib = await dev.listDir('/lib')
      expect(lib.map((e) => e.name)).toContain('mymod.py')

      expect(await dev.readFile('/lib/mymod.py')).toBe('VALUE = 7\n')

      const st = await dev.stat('/lib/mymod.py')
      expect(st.isDir).toBe(false)
      expect(st.size).toBe('VALUE = 7\n'.length)

      // The root hides the Emscripten system mounts (dev/proc/tmp/home).
      const root = await dev.listDir('/')
      expect(root.map((e) => e.name)).not.toContain('dev')
      expect(root.map((e) => e.name)).toContain('lib')
    } finally {
      await dev.dispose()
    }
  }, 30000)

  it('makes an uploaded module importable from the REPL (import instruments style)', async () => {
    const dev = new SimulatedDevice()
    const out: string[] = []
    dev.on('data', (c) => out.push(c.toString('utf8')))
    await dev.connect()
    try {
      // Upload a module to /lib (on sys.path), then import + use it from the REPL.
      await dev.mkdir('/lib')
      await dev.writeFile('/lib/greet.py', 'def hi():\n    print("imported-ok", 6 * 7)\n')
      await dev.sendData('import greet\r')
      await dev.sendData('greet.hi()\r')
      await new Promise((r) => setTimeout(r, 80))
      const text = out.join('')
      expect(text).toContain('imported-ok 42')
    } finally {
      await dev.dispose()
    }
  }, 30000)

  it('writeFile creates missing parent directories (no manual mkdir)', async () => {
    const dev = new SimulatedDevice()
    await dev.connect()
    try {
      // The VFS starts empty (no /lib), and /lib/auto is nested — writeFile must
      // create the whole parent chain rather than failing with OSError.
      await dev.writeFile('/lib/auto/mod.py', 'V=1\n')
      const ls = await dev.listDir('/lib/auto')
      expect(ls.map((e) => e.name)).toContain('mod.py')
      expect(await dev.readFile('/lib/auto/mod.py')).toBe('V=1\n')
    } finally {
      await dev.dispose()
    }
  }, 30000)

  it('rejects filesystem errors (e.g. removing a missing file)', async () => {
    const dev = new SimulatedDevice()
    await dev.connect()
    try {
      await expect(dev.remove('/does/not/exist.py')).rejects.toThrow()
    } finally {
      await dev.dispose()
    }
  }, 30000)
})
