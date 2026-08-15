/**
 * BUNDLED-DRIVER FRESHNESS (#707) — decide whether a bundled catalog module's
 * copy on the board is out of date, the way the instrument library already does
 * (`instrumentsLib.classifyPresentCopy`): compare the board's `__version__`
 * against the version the catalog declares. The board side is ONE
 * `readFileLine(path, '__version__')` (#700) — ~25 bytes on the wire, not the
 * file — after a `stat` that answers a different question (see below).
 *
 * Only the `/lib/<file>` copy Snakie manages is checked. `readFileLine` returns
 * `''` both for a MISSING file and for a file with no matching line, and those
 * must not read the same: a missing `/lib` copy means the import was satisfied
 * somewhere we don't own (a root shadow, frozen firmware, a hand-placed copy)
 * and is deliberately left alone, while a PRESENT copy with no version line is
 * a legacy install from before driver versioning and genuinely stale. The
 * `stat` supplies that distinction.
 */

import {
  installPathFor,
  parseModuleVersion,
  type ModuleDef
} from '../../../shared/modules-catalog'

/**
 * How one bundled module's board copy classifies:
 *  - `'current'`   — the `/lib` copy declares exactly the shipped version.
 *  - `'outdated'`  — the `/lib` copy differs: an older (or odd) version, a
 *    legacy copy with no `__version__`, or an unreadable file — all DIFFER from
 *    the known shipped version, and the update just rewrites the file, so a
 *    needless offer is harmless (the same rule as `classifyPresentCopy`).
 *  - `'unmanaged'` — no `/lib` copy exists; the import resolves from somewhere
 *    we don't own, so we never claim staleness for it.
 */
export type ModuleFreshness = 'current' | 'outdated' | 'unmanaged'

/**
 * Classify one bundled module's board copy from the probe outcomes. Pure.
 *
 * `libCopyExists` is the `stat` outcome for `/lib/<file>`; `versionLine` is
 * what `readFileLine` returned (`''` ⇒ no version line; `null` ⇒ the read
 * itself failed), and `shippedVersion` is the catalog-declared version.
 */
export function classifyBundledCopy(
  libCopyExists: boolean,
  versionLine: string | null,
  shippedVersion: string
): ModuleFreshness {
  if (!libCopyExists) return 'unmanaged'
  return parseModuleVersion(versionLine) === shippedVersion ? 'current' : 'outdated'
}

/**
 * Probe the `/lib` copies of the given defs (already known IMPORTABLE from the
 * import probe) and return the import-names whose copy is outdated. Non-bundled
 * defs are skipped (mip owns its own versions — nothing of ours to compare).
 * Tolerant of any device error: a failed `stat` reads as unmanaged (skip), a
 * failed line-read as outdated (see {@link ModuleFreshness}) — either way it
 * cannot throw, so a busy board degrades to a quiet probe, not a crash.
 */
export async function probeOutdatedModules(defs: ModuleDef[]): Promise<Set<string>> {
  const outdated = new Set<string>()
  for (const def of defs) {
    if (def.source.kind !== 'bundled') continue
    const path = installPathFor(def)
    if (!path) continue
    const exists = await window.api.device
      .stat(path)
      .then(() => true)
      .catch(() => false)
    const line = exists
      ? await window.api.device.readFileLine(path, '__version__').catch(() => null)
      : null
    if (classifyBundledCopy(exists, line, def.source.version) === 'outdated') {
      outdated.add(def.importName)
    }
  }
  return outdated
}
