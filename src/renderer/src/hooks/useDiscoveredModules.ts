import { useEffect, useState } from 'react'
import type { DiscoveredModules } from '../../../preload/index.d'
import { emptyDiscovery } from '../../../shared/module-discovery'

/**
 * SHARED "what can this board import?" probe (#1246).
 *
 * Two places want the answer — the Modules manager (so a module the FIRMWARE
 * provides doesn't render an INSTALL button that could never do anything) and
 * the Detected section (which lists the firmware's modules outright) — and the
 * answer costs a round-trip over one serial port. So the probe lives here and
 * is shared exactly the way `useDeviceStatus` shares its subscription: ONE
 * in-flight request, fanned out to every mounted hook, cached so a component
 * mounting later renders the known answer immediately.
 *
 * RE-PROBED when the answer could have changed: a board connects or drops, and
 * a driver is installed from any window (`modules.onChanged`). Plus
 * {@link refreshDiscoveredModules} for the Detected panel's RESCAN button,
 * because a file copied in from Finder is neither of those.
 *
 * Degrades to an empty result, never an error: a board that is busy or gone
 * costs the panels a section, and the rest of the UI carries on.
 */
export interface DiscoveryState {
  /** What the board reported. Empty when disconnected or not yet probed. */
  found: DiscoveredModules
  /** A probe is in flight. */
  scanning: boolean
}

const IDLE: DiscoveryState = { found: emptyDiscovery(), scanning: false }

let latest: DiscoveryState = IDLE
const subscribers = new Set<(s: DiscoveryState) => void>()
/** Bumped by every probe request; a late reply from an older one is discarded. */
let generation = 0
/**
 * The connection state the cached answer belongs to, or `null` when nothing has
 * been probed yet. Both panels mount at once and each asks on mount, which
 * without this would ask the same board the same question twice over one serial
 * port; a forced refresh bypasses it.
 */
let probedFor: boolean | null = null

function emit(s: DiscoveryState): void {
  latest = s
  for (const fn of subscribers) fn(s)
}

/**
 * Run the probe (or clear, when disconnected). Requests supersede each other by
 * generation rather than cancelling: the device layer has no cancel, so the only
 * honest thing is to ignore an answer that is no longer the current question.
 */
function probe(connected: boolean, force = true): void {
  if (!force && probedFor === connected) return
  probedFor = connected
  const mine = ++generation
  if (!connected) {
    emit(IDLE)
    return
  }
  emit({ found: latest.found, scanning: true })
  void window.api.modules
    .discover()
    .catch(() => emptyDiscovery())
    .then((found) => {
      if (mine === generation) emit({ found, scanning: false })
    })
}

/** Re-run the probe now (the Detected panel's RESCAN). No-op when disconnected. */
export function refreshDiscoveredModules(connected: boolean): void {
  probe(connected)
}

/**
 * Subscribe to the shared discovery result. `connected` comes from the caller's
 * `useDeviceStatus`, so the hook re-probes on exactly the transitions the board
 * makes — and every subscriber sees the one result.
 */
export function useDiscoveredModules(connected: boolean): DiscoveryState {
  const [state, setState] = useState<DiscoveryState>(latest)

  useEffect(() => {
    subscribers.add(setState)
    return () => {
      subscribers.delete(setState)
    }
  }, [])

  useEffect(() => {
    // Not forced: the first of the two panels to mount asks, the second reads
    // the cached answer (and both are re-probed on every connection change).
    probe(connected, false)
  }, [connected])

  // A driver installed from any window lands on the board without a reconnect.
  useEffect(() => {
    const off = window.api?.modules?.onChanged?.(() => probe(connected))
    return () => off?.()
  }, [connected])

  return state
}
