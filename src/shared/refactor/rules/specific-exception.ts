/**
 * Rule 30 — **Catch a specific exception** (epic #634 §3.5).
 *
 * ```python
 * try:                            try:
 *     with open(path) as f:           with open(path) as f:
 *         return f.read()                 return f.read()
 * except:                         except OSError:
 *     return DEFAULTS                 return DEFAULTS
 * ```
 *
 * A bare `except:` catches *everything* — including `KeyboardInterrupt`, so
 * Ctrl-C at the REPL no longer stops the program, and `SystemExit`, so
 * `sys.exit()` quietly carries on. It also hides your own typos: a
 * `NameError` in the `try` block looks exactly like the failure you were
 * expecting, and the robot drives on with the wrong value.
 *
 * `except Exception:` is a strict improvement and is always correct — it is
 * everything a bare except caught minus the two things you never meant to
 * catch. That is what this rule applies by default.
 *
 * When every call in the `try` block is file or hardware I/O, the rule offers
 * `except OSError:` instead, because that is what a missing file or an
 * unplugged I2C device actually raises. It cannot always know: a body that
 * mixes I/O with parsing can raise `ValueError` just as easily, and narrowing
 * there would let a real bug escape. So the OSError form is only offered when
 * the body contains nothing else, and the rule stays `safe: false` either way —
 * changing which errors escape a handler is the user's call, never a batch
 * tidy's.
 */
import type { Call, ExceptHandler, Stmt } from '../ast'
import type { AnyNode } from '../ast'
import { walk } from '../ast'
import type { TextEdit } from '../text'
import { dottedName } from '../expr'
import { defineRule } from '../types'
import type { RefactorContext, RefactorMatch } from '../types'

interface SpecificExceptionMatch {
  handler: ExceptHandler
  /** What to catch instead: the always-safe `Exception`, or `OSError`. */
  exc: 'Exception' | 'OSError'
}

/** The `except` keyword, which every handler starts with. */
const EXCEPT = 'except'

/**
 * Calls that fail with `OSError`: the file, socket and bus operations. Matched
 * on the last dotted segment so `f.read()`, `os.remove(p)` and a bare `open(p)`
 * all count regardless of how the module was imported.
 */
const IO_CALLS = new Set([
  'open',
  'read',
  'readline',
  'readlines',
  'readinto',
  'write',
  'writelines',
  'flush',
  'seek',
  'tell',
  'close',
  'remove',
  'unlink',
  'rename',
  'mkdir',
  'rmdir',
  'listdir',
  'ilistdir',
  'stat',
  'statvfs',
  'sync',
  'mount',
  'umount',
  'recv',
  'recvfrom',
  'recv_into',
  'send',
  'sendall',
  'sendto',
  'connect',
  'bind',
  'listen',
  'accept',
  'scan',
  'readfrom',
  'readfrom_into',
  'readfrom_mem',
  'readfrom_mem_into',
  'writeto',
  'writeto_mem',
  'writevto'
])

/** Constructors that hand back something whose methods raise `OSError`. */
const HARDWARE_CLASSES = new Set([
  'I2C',
  'SoftI2C',
  'SPI',
  'SoftSPI',
  'UART',
  'ADC',
  'PWM',
  'Pin',
  'SDCard',
  'RTC',
  'WDT',
  'Timer',
  'Signal',
  'onewire',
  'OneWire'
])

/** Every name in the file bound to a `machine.*` object or an open file. */
function hardwareNames(module: AnyNode): Set<string> {
  const names = new Set<string>()
  const fromCall = (call: Call): boolean => {
    const dotted = dottedName(call.func)
    if (!dotted) return false
    const parts = dotted.split('.')
    if (parts.length === 2 && (parts[0] === 'machine' || parts[0] === 'umachine')) return true
    if (parts.length === 1 && (parts[0] === 'open' || HARDWARE_CLASSES.has(parts[0]))) return true
    return false
  }
  walk(module, (n) => {
    if (n.type === 'Assign' && n.value.type === 'Call' && fromCall(n.value)) {
      for (const t of n.targets) if (t.type === 'Name') names.add(t.id)
    }
    if (n.type === 'With') {
      for (const item of n.items) {
        if (
          item.context.type === 'Call' &&
          fromCall(item.context) &&
          item.optionalVars?.type === 'Name'
        ) {
          names.add(item.optionalVars.id)
        }
      }
    }
  })
  return names
}

/** Does this call fail with `OSError` and nothing else? */
function isIoCall(call: Call, hardware: ReadonlySet<string>): boolean {
  const dotted = dottedName(call.func)
  if (!dotted) return false
  const parts = dotted.split('.')
  if (IO_CALLS.has(parts[parts.length - 1])) return true
  // `i2c.writeto_mem(...)` where `i2c = machine.I2C(0)` — any method on a
  // hardware object is a bus transaction.
  return parts.length > 1 && hardware.has(parts[0])
}

/**
 * True when the guarded block does I/O and *only* I/O. One non-I/O call — an
 * `int()`, a parser, a callback — and we can no longer say `OSError` is the
 * only thing worth catching.
 */
function isPurelyIo(body: readonly Stmt[], hardware: ReadonlySet<string>): boolean {
  let calls = 0
  let allIo = true
  for (const stmt of body) {
    walk(stmt, (n) => {
      if (n.type !== 'Call') return
      calls++
      if (!isIoCall(n, hardware)) allIo = false
    })
  }
  return calls > 0 && allIo
}

/**
 * Offset of the `:` that closes a bare handler's header, or -1 when anything
 * other than whitespace sits between `except` and the colon (a line
 * continuation, say) and we would rather not touch it.
 */
function bareHeaderColon(src: string, handler: ExceptHandler): number {
  if (src.slice(handler.start, handler.start + EXCEPT.length) !== EXCEPT) return -1
  const from = handler.start + EXCEPT.length
  const colon = src.indexOf(':', from)
  if (colon < 0) return -1
  if (src.slice(from, colon).trim() !== '') return -1
  return colon
}

export const specificExceptionRule = defineRule<SpecificExceptionMatch>({
  id: 'specific-exception',
  title: 'Catch a specific exception',
  message: 'A bare `except:` also swallows Ctrl-C and `sys.exit()` — name what you expect',
  catalogue: 30,
  category: 'functions',
  kind: 'quickfix',
  severity: 'warning',
  helpArticle: 'refactor-specific-exception',
  safe: false,

  detect(ctx: RefactorContext): RefactorMatch<SpecificExceptionMatch>[] {
    const out: RefactorMatch<SpecificExceptionMatch>[] = []
    // Only worth walking the file for hardware bindings if a bare except turns
    // up at all, which in most files it does not.
    let cached: ReadonlySet<string> | null = null
    const hardware = (): ReadonlySet<string> => {
      if (!cached) cached = hardwareNames(ctx.module as AnyNode)
      return cached
    }
    walk(ctx.module as AnyNode, (node) => {
      if (node.type !== 'Try') return
      for (const handler of node.handlers) {
        // `except*` is a bare handler only in code that would not compile.
        if (handler.exc || handler.isStar) continue
        const colon = bareHeaderColon(ctx.src, handler)
        if (colon < 0) continue
        const io = isPurelyIo(node.body, hardware())
        out.push({
          ruleId: 'specific-exception',
          start: handler.start,
          end: colon + 1,
          title: io
            ? 'Catch OSError instead of everything'
            : 'Catch Exception instead of everything',
          message: io
            ? 'This block only does I/O, so `OSError` is what it can actually raise'
            : 'A bare `except:` also swallows Ctrl-C and `sys.exit()` — name what you expect',
          data: { handler, exc: io ? 'OSError' : 'Exception' }
        })
      }
    })
    return out
  },

  apply(match: RefactorMatch<SpecificExceptionMatch>, ctx: RefactorContext): TextEdit[] | null {
    const { handler, exc } = match.data
    const colon = bareHeaderColon(ctx.src, handler)
    if (colon < 0) return null
    return [{ start: handler.start + EXCEPT.length, end: colon, newText: ` ${exc}` }]
  }
})
