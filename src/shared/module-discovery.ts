/**
 * EVERY MODULE THE BOARD CAN IMPORT — including the ones baked into firmware.
 * =============================================================================
 *
 * `modules-catalog.ts` answers "is THIS name installed?": `importProbeSnippet`
 * imports a name Snakie already knows about. That is the right shape for the
 * Modules manager's catalog and the wrong shape for the question a vendor board
 * raises. An Arduino Alvik ships a MicroPython image with `arduino_alvik`,
 * `ucPack` and a frozen `modulino` package compiled INTO it. None of those are
 * in our catalog, none of them are files on the filesystem, and so nothing in
 * Snakie could see them: `module-scan.ts` lists `/` and `/lib` and finds
 * nothing, the catalog probe never asks the question.
 *
 * A complete inventory is the UNION of three sources, and no single call
 * returns it:
 *
 *   1. BUILT-IN + FROZEN — `help('modules')`. `mp_help_print_modules`
 *      (`py/builtinhelp.c`) walks the builtin module map AND the frozen-module
 *      table, so everything compiled into the image appears WITHOUT importing
 *      any of it. This is the source that finds `arduino_alvik`.
 *   2. FILESYSTEM — a walk of `sys.path`. `help('modules')` deliberately does
 *      NOT scan the filesystem; it prints "Plus any modules on the filesystem"
 *      and stops. So `/lib/ssd1306.py` and everything `mip` installed is
 *      invisible to (1) and has to be listed directly.
 *   3. ALREADY IMPORTED — `sys.modules`, which catches anything a `boot.py`
 *      injected at runtime that is neither frozen nor a file.
 *
 * WHY THE PARSER IS THE FIDDLY HALF. `help('modules')` is a `print`, not a
 * return value, and it is formatted for a human:
 *
 *   - COLUMNS, padded to terminal width. Several names per line; split on all
 *     whitespace, never one-name-per-line.
 *   - A TRAILER — "Plus any modules on the filesystem" — which is prose, not
 *     names, and would otherwise contribute five bogus modules.
 *   - FROZEN SUB-PACKAGES CARRY A SLASH: `arduino_alvik/constants`. That is a
 *     path, not an import name, so it is normalised to a dotted name and its
 *     top-level package is recorded alongside it.
 *
 * NOTHING HERE IMPORTS ANYTHING. Discovery is a listing, and a listing that
 * imported every frozen module would `MemoryError` on an ESP32 — and, because
 * the catalog probe swallows exceptions, report a module ABSENT when it is
 * present and perfect. {@link moduleMembersSnippet} is the one call that does
 * import, for ONE named module at a time, and it purges + collects afterwards
 * exactly as `importProbeSnippet` does.
 *
 * Pure and dependency-free (the same discipline as `modules-catalog.ts`), so
 * main, preload, the web build and a unit test with no board all share one
 * probe and one parser.
 */

/** Sentinels delimiting the sections of the discovery probe's output. */
export const DISCOVER_FIRMWARE = '<<SNAKIE_DISCOVER_FW>>'
export const DISCOVER_PATH = '<<SNAKIE_DISCOVER_PATH>>'
export const DISCOVER_HELP = '<<SNAKIE_DISCOVER_HELP>>'
export const DISCOVER_SYS = '<<SNAKIE_DISCOVER_SYS>>'
export const DISCOVER_END = '<<SNAKIE_DISCOVER_END>>'

/** The sentinel {@link moduleMembersSnippet} prefixes each `dir()` name with. */
export const MEMBER_PREFIX = '<<SNAKIE_MEMBER>>'

/**
 * The trailer `help('modules')` prints after the names. Prose, not modules —
 * dropped before the output is split into tokens. Matched loosely (a `startsWith`
 * on the lower-cased line) because the wording has drifted across versions.
 */
const HELP_TRAILER = 'plus any modules on the filesystem'

/**
 * What the board says it is. Every field is optional: `os.uname()` is missing on
 * some ports, `sys.implementation._machine` and `._build` only exist on
 * MicroPython ≥1.20, and a vendor image may fill in some and not others. The
 * panel uses this to LABEL the extras ("frozen into Arduino Nano ESP32
 * firmware") rather than listing mystery names.
 */
export interface FirmwareIdentity {
  /** `os.uname().sysname` — the port (`esp32`, `rp2`). */
  sysname?: string
  /** `os.uname().machine` — the board (`Arduino Nano ESP32 with ESP32S3`). */
  machine?: string
  /** `os.uname().release` — the MicroPython version (`1.23.0`). */
  release?: string
  /** `os.uname().version` — the build string, often with a vendor tag. */
  version?: string
  /** `sys.implementation.name` — `micropython`, or `circuitpython`. */
  implementation?: string
  /** `sys.implementation._machine`, where the port provides it. */
  implMachine?: string
  /** `sys.implementation._build` — the board's build name (`ARDUINO_NANO_ESP32`). */
  build?: string
}

/** Everything the discovery probe found on the board. */
export interface DiscoveredModules {
  /**
   * Top-level names that are BUILT IN or FROZEN — compiled into the firmware,
   * not files. Sorted, de-duplicated. These cannot be installed, updated or
   * deleted, which is why they get their own status rather than reading as
   * "installed".
   */
  frozen: string[]
  /**
   * Dotted names of frozen SUB-modules (`arduino_alvik.constants`), recovered
   * from the slash-separated paths `help('modules')` prints. The top-level
   * package of each also appears in {@link frozen}.
   */
  frozenSubmodules: string[]
  /** Module names found as `.py`/`.mpy` files on `sys.path`. Sorted, unique. */
  filesystem: string[]
  /** Top-level names already in `sys.modules` when the probe ran. Sorted, unique. */
  imported: string[]
  /** `sys.path` as the board reports it, in order. */
  searchPath: string[]
  /** What the board says it is; `{}` when nothing could be read. */
  firmware: FirmwareIdentity
}

/** An empty result — what every failure degrades to. */
export function emptyDiscovery(): DiscoveredModules {
  return {
    frozen: [],
    frozenSubmodules: [],
    filesystem: [],
    imported: [],
    searchPath: [],
    firmware: {}
  }
}

/**
 * The one-shot discovery probe: firmware identity, `sys.path`, the built-in and
 * frozen module list, the filesystem walk, and `sys.modules`. Each section is
 * fenced by a sentinel so the parser never has to guess where one ends.
 *
 * `help('modules')` is run LAST of the printing work and its output is the only
 * free-form section, so a port that formats it unusually can only ever corrupt
 * its own section.
 *
 * Runs in one `device.exec` round-trip, imports nothing beyond `sys`/`os`, and
 * cannot throw on the board: every step that a port might not support is
 * individually wrapped, because a board missing `os.uname()` must still return
 * its module list.
 */
export function discoverSnippet(): string {
  return [
    'import sys',
    `print('${DISCOVER_FIRMWARE}')`,
    'try:',
    '    import os as _snk_os',
    '    _snk_u = _snk_os.uname()',
    "    for _snk_f in ('sysname', 'machine', 'release', 'version'):",
    '        try:',
    "            print(_snk_f + '=' + str(getattr(_snk_u, _snk_f)))",
    '        except Exception:',
    '            pass',
    '    _snk_u = None',
    'except Exception:',
    '    pass',
    'try:',
    '    _snk_i = sys.implementation',
    "    print('implementation=' + str(_snk_i.name))",
    "    for _snk_f in ('_machine', '_build'):",
    '        _snk_v = getattr(_snk_i, _snk_f, None)',
    '        if _snk_v:',
    "            print(_snk_f + '=' + str(_snk_v))",
    '    _snk_i = None',
    'except Exception:',
    '    pass',
    // sys.path, so the caller can explain WHERE a filesystem module was found.
    `print('${DISCOVER_PATH}')`,
    'try:',
    '    for _snk_p in sys.path:',
    '        print(_snk_p)',
    'except Exception:',
    '    pass',
    // The filesystem walk help('modules') explicitly does not do.
    'try:',
    '    for _snk_p in sys.path:',
    '        try:',
    "            _snk_d = _snk_p if _snk_p else '.'",
    '            for _snk_e in _snk_os.ilistdir(_snk_d):',
    '                _snk_n = _snk_e[0]',
    '                if _snk_e[1] & 0x4000:',
    "                    for _snk_x in ('/__init__.py', '/__init__.mpy'):",
    '                        try:',
    "                            _snk_os.stat(_snk_d + '/' + _snk_n + _snk_x)",
    "                            print('file:' + _snk_n)",
    '                            break',
    '                        except Exception:',
    '                            pass',
    "                elif _snk_n.endswith('.py') or _snk_n.endswith('.mpy'):",
    "                    print('file:' + _snk_n.rsplit('.', 1)[0])",
    '        except Exception:',
    '            pass',
    'except Exception:',
    '    pass',
    // What is already live in this session.
    `print('${DISCOVER_SYS}')`,
    'try:',
    '    for _snk_k in sys.modules:',
    '        print(_snk_k)',
    'except Exception:',
    '    pass',
    // Built-in + frozen. Prints in columns; the parser owns that.
    `print('${DISCOVER_HELP}')`,
    'try:',
    "    help('modules')",
    'except Exception:',
    '    pass',
    `print('${DISCOVER_END}')`,
    // Leave the board as we found it.
    'try:',
    '    _snk_os = None',
    '    _snk_p = None',
    '    _snk_e = None',
    '    _snk_n = None',
    '    _snk_d = None',
    '    _snk_x = None',
    '    _snk_k = None',
    '    _snk_f = None',
    '    _snk_v = None',
    '    import gc',
    '    gc.collect()',
    'except Exception:',
    '    pass'
  ].join('\n')
}

/** A plausible dotted import name (what survives tokenising `help('modules')`). */
function isModuleToken(token: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(token)
}

/**
 * The module names in a block of `help('modules')` output.
 *
 * Splits on ALL whitespace (the output is column-padded, several names per
 * line), drops the "Plus any modules on the filesystem" trailer and anything
 * else that is not a plausible import name, and normalises the slash a frozen
 * sub-package is printed with (`arduino_alvik/constants`) into a dotted name.
 *
 * `__main__` is dropped: it is always listed and is never something a learner
 * imports, and `pkg/__init__` is recorded as the PACKAGE rather than as a
 * `pkg.__init__` sub-module that does not exist. Returns `{ top, dotted }` — top-level names, and the dotted names of
 * any sub-modules — each sorted and de-duplicated. Pure.
 */
export function parseHelpModules(text: string): { top: string[]; dotted: string[] } {
  const top = new Set<string>()
  const dotted = new Set<string>()
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    // The trailer is prose; tokenising it would add five bogus module names.
    if (trimmed.toLowerCase().startsWith(HELP_TRAILER)) continue
    for (const raw of trimmed.split(/\s+/)) {
      // A frozen sub-package is printed as a PATH, not an import name.
      const token = raw.replace(/\.(py|mpy)$/, '').replace(/\//g, '.')
      if (!isModuleToken(token) || token === '__main__') continue
      const parts = token.split('.')
      const head = parts[0]
      top.add(head)
      // `modulino/__init__` IS the package, not something inside it — recording
      // it as a sub-module would put a phantom `modulino.__init__` in the list.
      if (parts.length > 1 && parts[parts.length - 1] !== '__init__') dotted.add(token)
    }
  }
  return { top: [...top].sort(), dotted: [...dotted].sort() }
}

/** The text between two sentinels, or `''` when the fence is missing/truncated. */
function section(out: string, from: string, to: string): string {
  const start = out.indexOf(from)
  if (start < 0) return ''
  const body = out.slice(start + from.length)
  const end = body.indexOf(to)
  return end < 0 ? body : body.slice(0, end)
}

/** Non-empty trimmed lines of a section. */
function lines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
}

/**
 * Parse {@link discoverSnippet}'s output into a {@link DiscoveredModules}.
 *
 * Tolerant by construction: a section whose sentinel never arrived (a board
 * that dropped mid-probe, a port where `help` is compiled out) simply comes
 * back empty, and the sections that DID arrive are still returned. Never
 * throws. Pure.
 */
export function parseDiscovery(stdout: string): DiscoveredModules {
  const out = `${stdout ?? ''}`
  const result = emptyDiscovery()

  for (const line of lines(section(out, DISCOVER_FIRMWARE, DISCOVER_PATH))) {
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq)
    const value = line.slice(eq + 1).trim()
    if (!value) continue
    if (key === 'sysname') result.firmware.sysname = value
    else if (key === 'machine') result.firmware.machine = value
    else if (key === 'release') result.firmware.release = value
    else if (key === 'version') result.firmware.version = value
    else if (key === 'implementation') result.firmware.implementation = value
    else if (key === '_machine') result.firmware.implMachine = value
    else if (key === '_build') result.firmware.build = value
  }

  // `sys.path` and the filesystem walk share a section: the walk's lines are
  // prefixed so a directory named like a module can never be mistaken for one.
  const files = new Set<string>()
  for (const line of lines(section(out, DISCOVER_PATH, DISCOVER_SYS))) {
    if (line.startsWith('file:')) {
      const name = line.slice('file:'.length).trim()
      if (isModuleToken(name)) files.add(name)
    } else {
      result.searchPath.push(line)
    }
  }
  result.filesystem = [...files].sort()

  const imported = new Set<string>()
  for (const line of lines(section(out, DISCOVER_SYS, DISCOVER_HELP))) {
    if (!isModuleToken(line) || line === '__main__') continue
    imported.add(line.split('.')[0])
  }
  result.imported = [...imported].sort()

  const help = parseHelpModules(section(out, DISCOVER_HELP, DISCOVER_END))
  result.frozen = help.top
  result.frozenSubmodules = help.dotted
  return result
}

/**
 * Every importable top-level name the probe found, from all three sources,
 * sorted and de-duplicated — the answer to "what can this board import?". Pure.
 */
export function allModuleNames(found: DiscoveredModules): string[] {
  return [...new Set([...found.frozen, ...found.filesystem, ...found.imported])].sort()
}

/**
 * The names that are in the firmware and NOT on the filesystem — the ones a
 * file-listing scan can never see, and the only ones worth labelling "built
 * into this board". A frozen module shadowed by a same-named file on `sys.path`
 * is excluded: the file is what actually imports, so the panel should describe
 * the file. Pure.
 */
export function firmwareOnlyNames(found: DiscoveredModules): string[] {
  const onDisk = new Set(found.filesystem)
  return found.frozen.filter((n) => !onDisk.has(n))
}

/**
 * A one-module `dir()` probe: import `name`, print each public attribute, then
 * PUT IT BACK — the same purge-and-collect discipline `importProbeSnippet`
 * carries, and for the same reason. The frozen packages this is most useful for
 * (`modulino`, `arduino_alvik`) are also the ones that eagerly import a dozen
 * submodules, so leaving one resident costs the next probe its memory.
 *
 * `dir()` is the only way to see inside a frozen module — there is no source
 * file to read, so the text-only reader `module-scan.ts` uses cannot apply.
 * What comes back is NAMES ONLY: no signatures, no docstrings, no distinction
 * between a class and a function. The caller must word it honestly.
 *
 * Dunders are filtered ON THE BOARD, so a long attribute list costs less over
 * the serial link. Never throws on the device.
 */
export function moduleMembersSnippet(name: string): string {
  // `name` reaches here from a device listing, so it is sanitised to a dotted
  // identifier before it is ever interpolated into source the board executes.
  const safe = name
    .split('.')
    .map((part) => part.replace(/[^A-Za-z0-9_]/g, ''))
    .filter(Boolean)
    .join('.')
  if (!safe) return ''
  const head = safe.split('.')[0]
  const purge = [
    '_snk_k = None',
    'for _snk_k in list(sys.modules):',
    `    if _snk_k == '${head}' or _snk_k.startswith('${head}.'):`,
    '        sys.modules.pop(_snk_k, None)'
  ]
  return [
    'import sys, gc',
    ...purge,
    'try:',
    `    _snk_m = __import__('${safe}')`,
    // `__import__('a.b')` binds the TOP package; walk down to the real module.
    `    for _snk_p in '${safe}'.split('.')[1:]:`,
    '        _snk_m = getattr(_snk_m, _snk_p)',
    '    for _snk_a in dir(_snk_m):',
    "        if not _snk_a.startswith('__'):",
    `            print('${MEMBER_PREFIX}' + _snk_a)`,
    '    _snk_m = None',
    'except Exception:',
    '    pass',
    ...purge,
    '_snk_k = None',
    'gc.collect()'
  ].join('\n')
}

/** The member names {@link moduleMembersSnippet} printed. Sorted, unique. Pure. */
export function parseModuleMembers(stdout: string): string[] {
  const names = new Set<string>()
  for (const line of `${stdout ?? ''}`.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed.startsWith(MEMBER_PREFIX)) continue
    const name = trimmed.slice(MEMBER_PREFIX.length).trim()
    if (name) names.add(name)
  }
  return [...names].sort()
}

/**
 * A one-line description of the board for the firmware section's header —
 * "Arduino Nano ESP32 · MicroPython 1.23.0", or `null` when the probe learned
 * nothing. Prefers `os.uname().machine` (the friendly board name) over the
 * build tag. Pure.
 */
export function describeFirmware(fw: FirmwareIdentity): string | null {
  const board = fw.machine ?? fw.implMachine ?? fw.build ?? fw.sysname
  const impl = fw.implementation === 'circuitpython' ? 'CircuitPython' : 'MicroPython'
  const version = fw.release
  const parts = [board, version ? `${impl} ${version}` : null].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ') : null
}
