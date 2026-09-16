import { scratchBlock, scratchName } from '../../../../shared/device-scratch'
import type { CuratedMember } from './module-api'

/**
 * ASKING THE BOARD WHAT A MODULE CONTAINS (#1048, epic #1007).
 * =============================================================================
 *
 * The tier for everything with no source to read: a frozen module, a C module,
 * a `.mpy`. `machine` itself is the example — there is no `machine.py` anywhere,
 * and there never will be.
 *
 * WHY IT IS SAFE TO IMPORT HERE, having refused to in `module-api.ts`. That file
 * refuses because importing on the HOST executes a downloaded file inside
 * Snakie. This imports on the BOARD — the learner's own device, about to run
 * that very driver the moment they press Run. It is the same exposure as
 * pressing Run, not a new one.
 *
 * WHAT IT CAN AND CANNOT GET. `dir()` plus `isinstance(_, type)` and `callable`
 * gives NAME and KIND — class, function, or constant. It cannot give
 * SIGNATURES: MicroPython strips `__doc__`, and `inspect` cannot sign a native
 * function (`machine.Pin.__init__.__doc__` raises `AttributeError`). So a block
 * from this tier has its method name filled in and no sockets, which is still a
 * great deal better than typing the name from memory into #1018's call block.
 *
 * ONE ROUND TRIP FOR THE WHOLE SET, and tolerant of everything: a module that
 * will not import contributes nothing rather than failing the batch, exactly as
 * `probeInstalled` does.
 */

/** The sentinel a probed member is printed behind. Chosen not to collide. */
export const MEMBER_MARK = '<<SNAKIE_MOD_MEMBER>>'

/**
 * Python that prints one `MEMBER_MARK <module> <kind> <name>` per public member.
 *
 * `dir()` on a module includes its own imports (`ssd1306` shows `framebuf`), so
 * this is not a filter anything downstream can skip — but the *kinds* are right,
 * and a class that is really another module's class is still a class you can
 * use through this one. Underscored names are dropped on the board rather than
 * in the renderer, so the line count stays small on a slow serial link.
 */
export function memberProbeSnippet(modules: readonly string[]): string {
  const safe = modules.map((m) => m.replace(/[^A-Za-z0-9_]/g, '')).filter((m) => m !== '')
  if (safe.length === 0) return ''
  const mod = scratchName('m')
  const obj = scratchName('o')
  const nm = scratchName('n')
  const kind = scratchName('k')
  const body: string[] = ['import sys']
  for (const name of safe) {
    body.push(
      'try:',
      `    ${mod} = __import__('${name}')`,
      `    for ${nm} in dir(${mod}):`,
      `        if ${nm}.startswith('_'):`,
      '            continue',
      '        try:',
      `            ${obj} = getattr(${mod}, ${nm})`,
      '        except Exception:',
      '            continue',
      // `isinstance(_, type)` first: a class is callable too, and answering
      // "function" for `machine.Pin` would build the wrong kind of block.
      `        ${kind} = 'class' if isinstance(${obj}, type) else ('function' if callable(${obj}) else 'constant')`,
      `        print('${MEMBER_MARK}', '${name}', ${kind}, ${nm})`,
      'except Exception:',
      // A module that will not import contributes nothing. It must not take the
      // rest of the batch down with it.
      '    pass'
    )
  }
  return scratchBlock(body, mod, obj, nm, kind)
}

/** One module's members, as the probe reported them. */
export type ProbedMembers = Record<string, CuratedMember[]>

/**
 * Read the probe's output.
 *
 * Tolerant by construction: the learner's own `print()`s share this stream, and
 * a line that is not ours is simply not ours. A truncated or garbled line is
 * dropped rather than guessed at.
 */
export function readMemberProbe(stdout: string): ProbedMembers {
  const out: ProbedMembers = {}
  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line.startsWith(`${MEMBER_MARK} `)) continue
    const parts = line.slice(MEMBER_MARK.length + 1).trim().split(/\s+/)
    if (parts.length !== 3) continue
    const [module, kind, name] = parts
    if (kind !== 'class' && kind !== 'function' && kind !== 'constant') continue
    if (!/^[A-Za-z_]\w*$/.test(name) || !/^[A-Za-z_]\w*$/.test(module)) continue
    const list = (out[module] ??= [])
    // The board can list a name twice (a module re-exporting its own import).
    if (!list.some((m) => m.name === name)) list.push({ name, kind })
  }
  return out
}
