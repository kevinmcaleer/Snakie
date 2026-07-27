/**
 * Bundled-library seed/refresh policy (#166) — the pure decision logic behind how
 * the "Standard Parts" library seeded into `<userData>/parts` is kept in step with
 * the bundle shipped in the app, WITHOUT clobbering a user's own edits.
 *
 * The original seeder only ever copied wholly-new part folders and never touched
 * an existing one, so a part seeded before a field was added (e.g. a board's
 * `footprint`, a carrier's `mounts`) stayed frozen without it — silently breaking
 * board seating for anyone who installed early. This module decides, per part,
 * whether to full-refresh, backfill missing fields, or leave it alone, driven by a
 * hash of what the seeder last wrote (so genuine user edits are detectable).
 *
 * Dependency-free but for the `yaml` package (already a shared dep) — no fs / no
 * electron — so the policy is unit-testable in isolation. The disk IO lives in
 * `src/main/parts/library.ts`, which feeds these helpers hashes + file text.
 */

import { parse, stringify } from 'yaml'

/** What the seeder recorded about a previous sync, per bundled library. */
export interface SeedManifest {
  /** The bundled `library.yml` `version` the install was last synced to. */
  version: string
  /** Part folder → sha256 of the `parts.yml` the seeder last wrote/knew, so an
   *  install that still matches this is "untouched" and safe to full-refresh, while
   *  a mismatch means the user edited it (keep it, only backfill missing fields). */
  parts: Record<string, string>
}

/** The action to take for one bundled part folder during a sync. */
export type PartSyncAction =
  /** Not installed yet → copy the whole folder in. */
  | 'copy-new'
  /** Installed, untouched since we seeded it → overwrite with the newer bundle. */
  | 'refresh'
  /** Installed and edited (or of unknown provenance) → keep it, but add any
   *  top-level fields the bundle has that the local copy is missing. */
  | 'backfill'
  /** Already identical to the bundle → nothing to do. */
  | 'skip'

/**
 * Decide what to do with one bundled part, given hashes of the bundle's + the
 * install's `parts.yml` and the hash the seeder last recorded for it.
 *
 * - never installed        → `copy-new`
 * - identical to the bundle → `skip`
 * - untouched since seeded  → `refresh` (adopt the newer bundle wholesale)
 * - edited / unknown origin → `backfill` (preserve edits, add missing fields)
 */
export function planPartSync(args: {
  existsLocal: boolean
  localHash?: string
  bundleHash: string
  seededHash?: string
}): PartSyncAction {
  const { existsLocal, localHash, bundleHash, seededHash } = args
  if (!existsLocal || localHash === undefined) return 'copy-new'
  if (localHash === bundleHash) return 'skip'
  // Differs from the bundle. If it still matches what we last seeded, the user
  // hasn't touched it — safe to take the newer bundle. Otherwise it's their edit
  // (or we have no record), so keep it and only fill in fields it lacks.
  if (seededHash !== undefined && localHash === seededHash) return 'refresh'
  return 'backfill'
}

/**
 * Add every TOP-LEVEL key the bundle's `parts.yml` has that the local copy lacks,
 * leaving all existing local values untouched. Returns the (possibly rewritten)
 * text and whether anything changed. This is what lets a board seeded before
 * `footprint` existed gain it without discarding the user's other edits.
 *
 * Never overwrites a key the user already has (even a deliberately different value)
 * and never removes one; a key the user deleted may reappear, which is the safe
 * trade for keeping seating metadata in sync.
 */
export function backfillTopLevel(
  bundleText: string,
  localText: string
): { text: string; changed: boolean } {
  let bundleObj: Record<string, unknown>
  let localObj: Record<string, unknown>
  try {
    bundleObj = (parse(bundleText) ?? {}) as Record<string, unknown>
    localObj = (parse(localText) ?? {}) as Record<string, unknown>
  } catch {
    return { text: localText, changed: false }
  }
  let changed = false
  for (const key of Object.keys(bundleObj)) {
    if (!(key in localObj)) {
      localObj[key] = bundleObj[key]
      changed = true
    }
  }
  if (!changed) return { text: localText, changed: false }
  return { text: stringify(localObj, { lineWidth: 0 }), changed: true }
}
