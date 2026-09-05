/**
 * Rule 91 — **Reset the WiFi interface before connecting** (epic #634 §3.6,
 * MicroPython), issue #871.
 *
 * ```python
 * wlan = network.WLAN(network.STA_IF)
 * wlan.active(True)                  # ← on a soft reboot the radio is still
 * wlan.connect(SSID, PASSWORD)       #   mid-connect from the last run
 * ```
 *
 * Why it matters: pressing Run does a **soft reboot**, which re-runs `boot.py`
 * — but a soft reboot does not reset the ESP32's WiFi peripheral. The station
 * interface keeps whatever state the previous run left it in, and if that state
 * is "connecting", the next `connect()` refuses:
 *
 * ```
 * E (7111) wifi:sta is connecting, cannot set config
 * OSError: Wifi Internal State Error
 * ```
 *
 * The code is correct on a cold boot and fails on the second Run, which is a
 * particularly unhelpful way for a bug to present itself.
 *
 * The fix is to deinit the interface first. `active(False)` on an interface that
 * is already down is a no-op, so it costs nothing on a cold boot and makes the
 * soft-reset path work every time.
 *
 * Note what does NOT fix it: an `isconnected()` guard. The station is
 * *connecting*, not connected, so the guard passes and `connect()` still
 * raises — which is why people reach for it, watch it not help, and conclude
 * the board is haunted.
 *
 * Not `safe`: bringing the interface down deliberately drops a live connection,
 * so "Tidy this file" must never batch this one in silently.
 */
import type { AnyNode, Call, Expr } from '../ast'
import { walk } from '../ast'
import { dottedName } from '../expr'
import { indentAt, lineStart, type TextEdit } from '../text'
import { defineRule } from '../types'
import type { RefactorContext, RefactorMatch } from '../types'

interface WifiResetMatch {
  /** The variable holding the interface, e.g. `wlan`. */
  name: string
  /** Offset of the line holding `name.active(True)`. */
  lineAt: number
}

/** Is this expression the literal `True`? */
function isTrue(node: Expr | undefined): boolean {
  return node?.type === 'Constant' && node.kind === 'bool' && node.raw === 'True'
}

/** Is this expression the literal `False`? */
function isFalse(node: Expr | undefined): boolean {
  return node?.type === 'Constant' && node.kind === 'bool' && node.raw === 'False'
}

/**
 * `x.active(…)` → `x`, for any dotted receiver. Returns null for a bare
 * `active(…)` or anything that is not a method call on a plain name.
 */
function activeReceiver(node: AnyNode): { call: Call; name: string; arg?: Expr } | null {
  if (node.type !== 'Call') return null
  const dotted = dottedName(node.func)
  if (!dotted || !dotted.endsWith('.active')) return null
  const name = dotted.slice(0, -'.active'.length)
  // Only a simple name receiver. `self.wlan.active(True)` is a real pattern but
  // the name we would have to insert is `self.wlan`, and proving that refers to
  // the same object across a method boundary is more than this rule should claim.
  if (name.includes('.')) return null
  return { call: node, name, arg: node.args[0] }
}

/**
 * Names bound to a WLAN interface somewhere in this file.
 *
 * Anchoring on the constructor is what keeps the rule off everything else with
 * an `active()` method — a Timer, a display driver, someone's own class. If the
 * file never builds a `WLAN`, the rule has nothing to say about it.
 */
function wlanNames(ctx: RefactorContext): Set<string> {
  const names = new Set<string>()
  walk(ctx.module as AnyNode, (node) => {
    if (node.type !== 'Assign') return
    const value = node.value
    if (value.type !== 'Call') return
    const ctor = dottedName(value.func)
    if (ctor !== 'WLAN' && ctor !== 'network.WLAN') return
    for (const target of node.targets) {
      if (target.type === 'Name') names.add(target.id)
    }
  })
  return names
}

export const wifiResetBeforeConnectRule = defineRule<WifiResetMatch>({
  id: 'wifi-reset-before-connect',
  title: 'Reset the WiFi interface before connecting',
  message: 'A soft reboot leaves the radio mid-connect, and the next connect() raises',
  catalogue: 91,
  category: 'micropython',
  kind: 'quickfix',
  severity: 'warning',
  helpArticle: 'refactor-wifi-reset-before-connect',
  // Bringing the interface down drops a live connection on purpose. Correct
  // here, but not something to batch into a "tidy the file" sweep unasked.
  safe: false,

  detect(ctx: RefactorContext): RefactorMatch<WifiResetMatch>[] {
    const names = wlanNames(ctx)
    if (names.size === 0) return []

    /** Every `name.active(True)`, `name.active(False)` and `name.connect(…)`. */
    const ups = new Map<string, Call[]>()
    const downs = new Map<string, Call[]>()
    const connects = new Set<string>()

    walk(ctx.module as AnyNode, (node) => {
      const hit = activeReceiver(node)
      if (hit && names.has(hit.name)) {
        const bucket = isTrue(hit.arg) ? ups : isFalse(hit.arg) ? downs : null
        if (bucket) {
          const list = bucket.get(hit.name)
          if (list) list.push(hit.call)
          else bucket.set(hit.name, [hit.call])
        }
        return
      }
      if (node.type !== 'Call') return
      const dotted = dottedName(node.func)
      if (!dotted) return
      const name = dotted.slice(0, dotted.lastIndexOf('.'))
      if (dotted.endsWith('.connect') && names.has(name)) connects.add(name)
    })

    const out: RefactorMatch<WifiResetMatch>[] = []
    for (const [name, calls] of ups) {
      // No `connect()` means the file only brings the interface up — an access
      // point, a scan — and the trap this rule is about needs a connect.
      if (!connects.has(name)) continue
      const first = calls.reduce((a, b) => (a.start <= b.start ? a : b))
      // Already deinits before bringing it up? Then it survives a soft reboot
      // and there is nothing to say.
      const deinitsFirst = (downs.get(name) ?? []).some((d) => d.start < first.start)
      if (deinitsFirst) continue

      out.push({
        ruleId: 'wifi-reset-before-connect',
        start: first.start,
        end: first.end,
        message:
          `Run does a soft reboot, which re-runs this file but leaves the radio as the last run ` +
          `left it. Add \`${name}.active(False)\` first so \`connect()\` cannot raise ` +
          `"Wifi Internal State Error"`,
        data: { name, lineAt: lineStart(ctx.src, first.start) }
      })
    }
    return out.sort((a, b) => a.start - b.start)
  },

  apply(match: RefactorMatch<WifiResetMatch>, ctx: RefactorContext): TextEdit[] | null {
    const { name, lineAt } = match.data
    // Match the indentation of the line being guarded, so this lands correctly
    // inside a function or an `if` as readily as at module level.
    const pad = indentAt(ctx.src, lineAt)
    return [
      {
        start: lineAt,
        end: lineAt,
        // A comment, because the line looks pointless to anyone who has not met
        // this bug — and a line that looks pointless gets deleted.
        newText: `${pad}# A soft reboot leaves the radio as the last run left it.${ctx.eol}${pad}${name}.active(False)${ctx.eol}`
      }
    ]
  }
})
