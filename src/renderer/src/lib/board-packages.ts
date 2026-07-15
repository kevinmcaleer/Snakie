/**
 * On-board package helpers for the Packages panel (#131).
 * =============================================================================
 * Everything is driven through `window.api.device` (listDir/eval/remove), so it
 * works identically on the desktop serial device, Web Serial hardware and the
 * WASM simulator — no new IPC. Pure helpers live here for unit testing.
 */

/** Modules baked into MicroPython firmware — never "missing" in an import scan. */
export const MICROPYTHON_BUILTINS = new Set<string>([
  'array', 'asyncio', 'binascii', 'bluetooth', 'builtins', 'cmath', 'collections',
  'cryptolib', 'deflate', 'errno', 'esp', 'esp32', 'framebuf', 'gc', 'hashlib',
  'heapq', 'io', 'json', 'machine', 'math', 'micropython', 'neopixel', 'network',
  'os', 'platform', 'random', 're', 'requests', 'rp2', 'select', 'socket', 'ssl',
  'struct', 'sys', 'time', 'uarray', 'uasyncio', 'ubinascii', 'ucollections',
  'uctypes', 'uerrno', 'uhashlib', 'uheapq', 'uio', 'ujson', 'umachine', 'uos',
  'urandom', 'ure', 'urequests', 'uselect', 'usocket', 'ussl', 'ustruct', 'usys',
  'utime', 'uzlib', 'webrepl', 'zlib', '_thread'
])

export interface BoardPackage {
  /** Import/package name (file stem or directory name). */
  name: string
  /** Full on-board path (`/lib/<entry>`), the uninstall target. */
  path: string
  isDir: boolean
  version?: string
}

/** Map a `/lib` directory entry to a package (null for non-module noise). */
export function libEntryToPackage(entry: { name: string; isDir: boolean }): BoardPackage | null {
  const n = entry.name
  if (!n || n.startsWith('.') || n === '__pycache__') return null
  if (entry.isDir) return { name: n, path: `/lib/${n}`, isDir: true }
  const m = /^(.+)\.(py|mpy)$/.exec(n)
  if (!m) return null
  return { name: m[1], path: `/lib/${n}`, isDir: false }
}

/**
 * Python that reads `__version__ = "…"` straight out of each package's source
 * WITHOUT importing it (importing a driver can touch hardware). Prints JSON.
 */
export function buildVersionProbe(pkgs: BoardPackage[]): string {
  const entries = pkgs
    .map((p) => `(${JSON.stringify(p.name)},${JSON.stringify(p.isDir ? `${p.path}/__init__.py` : p.path)})`)
    .join(',')
  return [
    'import json',
    `_out={}`,
    `for _n,_p in [${entries}]:`,
    '    try:',
    '        _f=open(_p)',
    '        for _l in _f:',
    "            if _l.startswith('__version__'):",
    "                _out[_n]=_l.split('=',1)[1].strip().strip('\\'\"')",
    '                break',
    '        _f.close()',
    '    except OSError:',
    '        pass',
    'print(json.dumps(_out))'
  ].join('\n')
}

/** Parse the probe's stdout into name → version (tolerates junk around it). */
export function parseVersionProbe(stdout: string): Record<string, string> {
  const m = /\{[^{}]*\}/.exec(stdout)
  if (!m) return {}
  try {
    const raw = JSON.parse(m[0]) as Record<string, unknown>
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(raw)) if (typeof v === 'string' && v) out[k] = v
    return out
  } catch {
    return {}
  }
}

/**
 * Which imports have nothing to satisfy them: not firmware built-ins, not on
 * the board, and not a module in the user's own project folder.
 */
export function missingProjectImports(
  imports: Iterable<string>,
  onBoard: Iterable<string>,
  projectModules: Iterable<string> = []
): string[] {
  const have = new Set<string>([...MICROPYTHON_BUILTINS])
  for (const n of onBoard) have.add(n.toLowerCase())
  for (const n of projectModules) have.add(n.toLowerCase())
  const missing = new Set<string>()
  for (const imp of imports) {
    const root = imp.split('.')[0].trim()
    if (!root) continue
    if (have.has(root) || have.has(root.toLowerCase())) continue
    missing.add(root)
  }
  return [...missing].sort()
}
