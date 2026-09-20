import { describe, expect, it } from 'vitest'
import {
  allModuleNames,
  describeFirmware,
  discoverSnippet,
  DISCOVER_END,
  DISCOVER_FIRMWARE,
  DISCOVER_HELP,
  DISCOVER_PATH,
  DISCOVER_SYS,
  emptyDiscovery,
  firmwareOnlyNames,
  MEMBER_PREFIX,
  moduleMembersSnippet,
  parseDiscovery,
  parseHelpModules,
  parseModuleMembers
} from '../src/shared/module-discovery'

/**
 * Unit tests for firmware/filesystem module discovery (#1246).
 *
 * The parser is the risky half: `help('modules')` is human-formatted output —
 * columns, a prose trailer, slash-separated frozen sub-packages — and every one
 * of those shapes turns into a bogus module name if it is handled naively. The
 * transcripts below are the real thing, taken from the shape MicroPython
 * prints on an ESP32 vendor image (the Arduino Alvik's, which is the board that
 * motivated this).
 */

/** An Alvik-shaped `help('modules')` block: columns, slashes, the trailer. */
const ALVIK_HELP = `__main__          asyncio/funcs     gc                uarray
_asyncio          asyncio/lock      inisetup          ubinascii
_boot             binascii          io                ucollections
_onewire          bluetooth         json              ucryptolib
_thread           btree             machine           uctypes
_webrepl          builtins          math              uhashlib
aioble/__init__   cmath             micropython       uheapq
aioble/client     collections       mip/__init__      uio
arduino_alvik     cryptolib         neopixel          ujson
arduino_alvik/constants             network           umachine
modulino/__init__ deflate           onewire           uos
modulino/buttons  dht               os                urandom
ucPack            esp               platform          ure
Plus any modules on the filesystem`

describe('parseHelpModules', () => {
  it('finds the vendor modules baked into the image', () => {
    const { top } = parseHelpModules(ALVIK_HELP)
    // The whole point: these are in no catalog and on no filesystem.
    expect(top).toContain('arduino_alvik')
    expect(top).toContain('ucPack')
    expect(top).toContain('modulino')
    expect(top).toContain('aioble')
  })

  it('splits columns rather than taking one name per line', () => {
    const { top } = parseHelpModules('gc                uarray            json')
    expect(top).toEqual(['gc', 'json', 'uarray'])
  })

  it('drops the "Plus any modules on the filesystem" trailer', () => {
    const { top } = parseHelpModules(ALVIK_HELP)
    for (const prose of ['Plus', 'any', 'modules', 'on', 'the', 'filesystem']) {
      expect(top).not.toContain(prose)
    }
  })

  it('turns a frozen sub-package path into a dotted name, and keeps its package', () => {
    const { top, dotted } = parseHelpModules('arduino_alvik/constants  aioble/client')
    expect(top).toEqual(['aioble', 'arduino_alvik'])
    expect(dotted).toEqual(['aioble.client', 'arduino_alvik.constants'])
  })

  it('records a package listed only as `pkg/__init__` under its own name', () => {
    const { top, dotted } = parseHelpModules('modulino/__init__')
    expect(top).toContain('modulino')
    // And NOT as a `modulino.__init__` sub-module, which is not importable.
    expect(dotted).toEqual([])
  })

  it('drops __main__ and anything that is not an import name', () => {
    const { top } = parseHelpModules('__main__  gc  >>>  some-thing  1234')
    expect(top).toEqual(['gc'])
  })

  it('is empty, not broken, for empty output', () => {
    expect(parseHelpModules('')).toEqual({ top: [], dotted: [] })
  })
})

/**
 * A VERBATIM `help('modules')` block from the real interpreter the e2e test
 * drives. Kept because it exhibits things no hand-written fixture would think
 * to: a name wide enough to push the rest of its row out of alignment
 * (`collections/__init__                io`), a module listed twice in one
 * block (`binascii`, `time`), and frozen sub-packages of a stdlib name
 * (`os/path`).
 */
const REAL_HELP = `__main__          collections/defaultdict             itertools         stat
_asyncio          copy              js                string
abc               datetime          jsffi             string/__init__
array             deflate           json              string/templatelib
asyncio/__init__  errno             locale            struct
binascii          hashlib           os                time
base64            heapq             os/__init__       types
abc2              html/__init__     os/path           uu
binascii          hmac              pathlib           unittest/__init__
collections       io                re                weakref
collections/__init__                io                select            zlib
Plus any modules on the filesystem`

describe('parseHelpModules, on a real interpreter transcript', () => {
  it('handles a row knocked out of alignment by a wide name', () => {
    const { top } = parseHelpModules(REAL_HELP)
    expect(top).toContain('collections')
    expect(top).toContain('io')
    expect(top).toContain('select')
    expect(top).toContain('zlib')
  })

  it('lists a name repeated across rows once', () => {
    const { top } = parseHelpModules(REAL_HELP)
    expect(top.filter((n) => n === 'binascii')).toEqual(['binascii'])
    expect(top.filter((n) => n === 'time')).toEqual(['time'])
  })

  it('reads sub-packages of a stdlib name as dotted sub-modules', () => {
    const { dotted } = parseHelpModules(REAL_HELP)
    expect(dotted).toContain('os.path')
    expect(dotted).toContain('collections.defaultdict')
    expect(dotted).toContain('string.templatelib')
    // `pkg/__init__` is the package itself, not a sub-module of it.
    expect(dotted).not.toContain('string.__init__')
    expect(parseHelpModules(REAL_HELP).top).toContain('string')
  })
})

/** A full probe transcript, sentinels and all. */
function transcript(opts: { help?: string; fw?: string; path?: string; sys?: string } = {}): string {
  return [
    DISCOVER_FIRMWARE,
    opts.fw ??
      [
        'sysname=esp32',
        'machine=Arduino Nano ESP32 with ESP32S3',
        'release=1.23.0',
        'version=v1.23.0 on 2024-06-02',
        'implementation=micropython',
        '_machine=Arduino Nano ESP32 with ESP32S3',
        '_build=ARDUINO_NANO_ESP32'
      ].join('\n'),
    DISCOVER_PATH,
    opts.path ?? ['', '.frozen', '/lib', 'file:ssd1306', 'file:my_robot'].join('\n'),
    DISCOVER_SYS,
    opts.sys ?? ['__main__', 'gc', 'arduino_alvik'].join('\n'),
    DISCOVER_HELP,
    opts.help ?? ALVIK_HELP,
    DISCOVER_END
  ].join('\n')
}

describe('parseDiscovery', () => {
  it('reads the firmware identity', () => {
    const found = parseDiscovery(transcript())
    expect(found.firmware).toEqual({
      sysname: 'esp32',
      machine: 'Arduino Nano ESP32 with ESP32S3',
      release: '1.23.0',
      version: 'v1.23.0 on 2024-06-02',
      implementation: 'micropython',
      implMachine: 'Arduino Nano ESP32 with ESP32S3',
      build: 'ARDUINO_NANO_ESP32'
    })
  })

  it('keeps a version string containing an "=" whole', () => {
    const found = parseDiscovery(transcript({ fw: 'version=v1.23 opt=size' }))
    expect(found.firmware.version).toBe('v1.23 opt=size')
  })

  it('separates sys.path entries from the filesystem walk', () => {
    const found = parseDiscovery(transcript())
    expect(found.searchPath).toEqual(['', '.frozen', '/lib'].filter(Boolean))
    expect(found.filesystem).toEqual(['my_robot', 'ssd1306'])
  })

  it('collapses sys.modules to top-level names and drops __main__', () => {
    const found = parseDiscovery(transcript({ sys: '__main__\narduino_alvik.constants\ngc' }))
    expect(found.imported).toEqual(['arduino_alvik', 'gc'])
  })

  it('reports the frozen modules and their sub-modules', () => {
    const found = parseDiscovery(transcript())
    expect(found.frozen).toContain('arduino_alvik')
    expect(found.frozenSubmodules).toContain('arduino_alvik.constants')
  })

  it('returns what did arrive when the output is truncated mid-probe', () => {
    const cut = `${DISCOVER_FIRMWARE}\nsysname=rp2\n${DISCOVER_PATH}\n/lib\n${DISCOVER_SYS}`
    const found = parseDiscovery(cut)
    expect(found.firmware.sysname).toBe('rp2')
    expect(found.searchPath).toEqual(['/lib'])
    expect(found.frozen).toEqual([])
  })

  it('is empty, not thrown, for junk and for nothing', () => {
    expect(parseDiscovery('')).toEqual(emptyDiscovery())
    expect(parseDiscovery('Traceback (most recent call last):')).toEqual(emptyDiscovery())
  })

  it('reports whether the probe finished, so empty is not ambiguous (#1254)', () => {
    // A board that answered and genuinely has nothing frozen, versus a probe
    // that never got an answer. The panel needs opposite words for these.
    expect(parseDiscovery(transcript()).complete).toBe(true)
    expect(parseDiscovery('').complete).toBe(false)
    expect(
      parseDiscovery(`${DISCOVER_FIRMWARE}\nsysname=rp2\n${DISCOVER_PATH}`).complete
    ).toBe(false)
  })
})

describe('allModuleNames / firmwareOnlyNames', () => {
  it('unions all three sources without duplicates', () => {
    const names = allModuleNames(parseDiscovery(transcript()))
    expect(names).toContain('arduino_alvik') // frozen + imported
    expect(names).toContain('ssd1306') // filesystem only
    expect(names).toEqual([...new Set(names)].sort())
  })

  it('excludes a frozen module that a file on sys.path shadows', () => {
    // A `/lib/modulino` copy is what actually imports, so the panel must
    // describe the FILE, not the frozen one it hides.
    const found = parseDiscovery(
      transcript({ path: ['/lib', 'file:modulino'].join('\n') })
    )
    expect(found.frozen).toContain('modulino')
    expect(firmwareOnlyNames(found)).not.toContain('modulino')
    expect(firmwareOnlyNames(found)).toContain('arduino_alvik')
  })
})

describe('discoverSnippet', () => {
  it('prints every section fence', () => {
    const src = discoverSnippet()
    for (const s of [DISCOVER_FIRMWARE, DISCOVER_PATH, DISCOVER_SYS, DISCOVER_HELP, DISCOVER_END]) {
      expect(src).toContain(s)
    }
  })

  it('imports nothing but sys/os/gc — a listing must not cost the board its RAM', () => {
    const imports = discoverSnippet().match(/^\s*import\s+(\S+)/gm) ?? []
    const names = imports.map((l) => l.trim().replace(/^import\s+/, ''))
    expect(names.sort()).toEqual(['gc', 'os', 'sys'])
    expect(discoverSnippet()).not.toContain('__import__')
  })

  it("wraps every port-dependent step, so a board without os.uname() still lists", () => {
    // One `try:` per optional step; none of them may be left bare.
    expect(discoverSnippet()).toContain('_snk_os.uname()')
    const tries = (discoverSnippet().match(/^try:/gm) ?? []).length
    expect(tries).toBeGreaterThanOrEqual(5)
  })
})

describe('moduleMembersSnippet', () => {
  it('imports the named module and prints its public names', () => {
    const src = moduleMembersSnippet('arduino_alvik')
    expect(src).toContain("__import__('arduino_alvik')")
    expect(src).toContain(MEMBER_PREFIX)
    expect(src).toContain("startswith('__')")
  })

  it('purges sys.modules before AND after, and collects', () => {
    const src = moduleMembersSnippet('modulino')
    // Twice: once to ask the filesystem rather than the cache, once to give the
    // memory back before anything else runs.
    expect(src.match(/sys\.modules\.pop/g)?.length).toBe(2)
    expect(src).toContain("_snk_k.startswith('modulino.')")
    expect(src).toContain('gc.collect()')
  })

  it('walks down to a sub-module, which __import__ does not return', () => {
    const src = moduleMembersSnippet('arduino_alvik.constants')
    expect(src).toContain("'arduino_alvik.constants'.split('.')[1:]")
    // The purge is by TOP-LEVEL package, or the package itself stays resident.
    expect(src).toContain("_snk_k == 'arduino_alvik'")
  })

  it('sanitises a name so nothing else can be executed', () => {
    const src = moduleMembersSnippet("os'); import machine; ('")
    expect(src).not.toContain('machine;')
    expect(src).toContain("__import__('osimportmachine')")
  })

  it('returns nothing to run for a name with no identifier left in it', () => {
    expect(moduleMembersSnippet('!!!')).toBe('')
    expect(moduleMembersSnippet('')).toBe('')
  })
})

describe('parseModuleMembers', () => {
  it('takes only the sentinel lines, sorted and unique', () => {
    const out = [
      'noise on the line',
      `${MEMBER_PREFIX}get_distance`,
      `${MEMBER_PREFIX}ArduinoAlvik`,
      `${MEMBER_PREFIX}get_distance`
    ].join('\r\n')
    expect(parseModuleMembers(out)).toEqual(['ArduinoAlvik', 'get_distance'])
  })

  it('is empty for a module that printed nothing', () => {
    expect(parseModuleMembers('')).toEqual([])
  })
})

describe('describeFirmware', () => {
  it('names the board and the runtime', () => {
    expect(
      describeFirmware({ machine: 'Arduino Nano ESP32', release: '1.23.0' })
    ).toBe('Arduino Nano ESP32 · MicroPython 1.23.0')
  })

  it('falls back through the fields a port may not have', () => {
    expect(describeFirmware({ build: 'ARDUINO_NANO_ESP32' })).toBe('ARDUINO_NANO_ESP32')
    expect(describeFirmware({ release: '1.23.0' })).toBe('MicroPython 1.23.0')
    expect(describeFirmware({ implementation: 'circuitpython', release: '9.0.0' })).toBe(
      'CircuitPython 9.0.0'
    )
  })

  it('is null when the board said nothing', () => {
    expect(describeFirmware({})).toBeNull()
  })
})
