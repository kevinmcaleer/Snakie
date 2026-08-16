/**
 * ELECTRONICS ↔ BUILD SYNC PLAN (#717, epic #720). The pure classifier behind
 * the Sync button in both workspaces: compare the Electronics manifest
 * (robot.yml parts + board) against the Build model (the project URDF) and name
 * every way they disagree, each with the action(s) that would reconcile it.
 *
 * The plan NEVER acts — per #626's design decision (flag, don't auto-delete),
 * anything destructive goes through the user in the reconcile dialog. Additive
 * items (a part with no body) default to "add", matching placement's own
 * auto-appear behaviour.
 *
 * Identity rules (see RobotPart.urdfLink): a recorded link that still exists is
 * authoritative; one that names no link is DANGLING and treated exactly like an
 * absent record, falling back to the legacy sanitised-name match. Orphans are
 * only knowable from `RobotModel.orphanedLinks`, recorded at delete time — the
 * reference lived on the deleted part.
 */
import type { PartDefinition, PartLibraryWithParts } from '../../../shared/part'
import type { RobotDefinition, RobotPart } from '../../../shared/robot'
import { readRobotModel } from '../../../shared/krf'
import { linkGeometryKind, parseAssembly, readInertial, uniqueLinkName } from './robot-assembly'

/** One reconcilable difference between the two workspaces. */
export type SyncItem =
  | {
      kind: 'missing-body'
      /** The placed part with no Build body ('board' for the MCU). */
      partId: string
      label: string
      /** True when a recorded link DANGLES (named link gone) rather than never
       *  existed — worth different wording in the dialog. */
      dangling: boolean
    }
  | {
      kind: 'orphan-link'
      /** The stranded URDF link (its Electronics part was deleted). */
      link: string
      /** The ledger entry that flagged it — what a resolution clears. A legacy
       *  delete records a name GUESS, so this can differ from `link`. */
      ledger: string
    }
  | {
      kind: 'placeholder-upgradable'
      partId: string
      label: string
      link: string
    }
  | {
      kind: 'mass-drift'
      partId: string
      label: string
      link: string
      /** The part library's grams vs the link's current kilograms. */
      partMassG: number
      linkMassKg: number | null
    }

/** Resolve a part definition from the installed libraries; with no `lib`, every
 *  library is searched (how the MCU board id resolves — boards are parts). */
function resolveDef(
  libraries: PartLibraryWithParts[],
  lib: string | undefined,
  partId: string | undefined
): PartDefinition | undefined {
  if (!partId) return undefined
  for (const l of libraries) {
    if (lib && l.id !== lib) continue
    const hit = l.parts?.find((p) => p.id === partId)
    if (hit) return hit
  }
  return undefined
}

/** The sanitised base a part's link name was minted from (uniqueLinkName's rule). */
export function linkBaseName(name: string): string {
  return name.replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'part'
}

/** Find `base` (or its `base_N` mint-suffix variants) among UNCLAIMED links.
 *  Claimed links are another row's body — matching one would silently share it,
 *  which is exactly how a duplicated part lost its own body (review find). */
function nameMatch(links: Set<string>, claimed: Set<string>, base: string): string | null {
  if (links.has(base) && !claimed.has(base)) return base
  for (const l of links) {
    if (claimed.has(l)) continue
    if (l.startsWith(`${base}_`) && /^\d+$/.test(l.slice(base.length + 1))) return l
  }
  return null
}

/** A placed part's ACTUAL Build link right now: the recorded one when it still
 *  exists, else an unclaimed name match, else null. Exported for the hierarchy
 *  (#718). Callers resolve urdfLink-recorded rows FIRST so their claims win. */
export function resolvePartLink(
  links: Set<string>,
  claimed: Set<string>,
  part: PartDefinition | undefined,
  row: RobotPart
): { link: string | null; dangling: boolean } {
  if (row.urdfLink && links.has(row.urdfLink)) return { link: row.urdfLink, dangling: false }
  const matched = nameMatch(links, claimed, linkBaseName(part?.name || row.part))
  return { link: matched, dangling: Boolean(row.urdfLink) }
}

/**
 * Compare the manifest against the URDF and return every mismatch. Pure.
 *
 * `urdfText` may be empty/absent (no Build model yet) — then every part is
 * simply `missing-body`. Mass drift only fires when the robot.yml linkMass
 * source for that link is `library` or unset: a MEASURED mass is the user's
 * kitchen-scale truth and is never second-guessed by the library number.
 */
export function computeSyncPlan(
  robot: RobotDefinition,
  urdfText: string | null | undefined,
  libraries: PartLibraryWithParts[]
): SyncItem[] {
  const urdf = urdfText ?? ''
  const links = new Set(parseAssembly(urdf).map((i) => i.link))
  const model = readRobotModel(robot)
  const items: SyncItem[] = []
  const claimed = new Set<string>()

  // Claims resolve in trust order: recorded links first (board, then parts),
  // THEN legacy name-matches over what's left — so a name-match can never steal
  // a link another row explicitly recorded, and two same-named rows don't share
  // one body (the duplicated-part case: the clone must come up link-less).
  const recordedBoard = model?.boardLink && links.has(model.boardLink) ? model.boardLink : null
  if (recordedBoard) claimed.add(recordedBoard)
  for (const row of robot.parts) {
    if (row.urdfLink && links.has(row.urdfLink)) claimed.add(row.urdfLink)
  }

  // --- the MCU board (not a RobotPart; its record lives on the model) --------
  if (robot.board && !recordedBoard) {
    const def = resolveDef(libraries, undefined, robot.board)
    items.push({
      kind: 'missing-body',
      partId: 'board',
      label: def?.name || robot.board,
      dangling: Boolean(model?.boardLink)
    })
  }

  // --- placed parts ----------------------------------------------------------
  for (const row of robot.parts) {
    const def = resolveDef(libraries, row.lib, row.part)
    const { link, dangling } = resolvePartLink(links, claimed, def, row)
    if (!link) {
      items.push({ kind: 'missing-body', partId: row.id, label: row.label || row.part, dangling })
      continue
    }
    claimed.add(link)
    // Placeholder that could be a real mesh now.
    if (def?.mesh && linkGeometryKind(urdf, link) === 'box') {
      items.push({
        kind: 'placeholder-upgradable',
        partId: row.id,
        label: row.label || row.part,
        link
      })
    }
    // Library mass vs the link's inertial — never against a measured mass. The
    // tolerance is half the writers' 4-dp-kg quantum (0.1 g): a stricter compare
    // flagged un-clearable phantom drift for any mass finer than 0.1 g.
    if (typeof def?.mass_g === 'number' && def.mass_g > 0) {
      const source = model?.linkMass?.[link]?.source
      if (source === undefined || source === 'library' || source === 'none') {
        const inertial = readInertial(urdf, link)
        if (inertial === null || Math.abs(inertial.mass * 1000 - def.mass_g) > 0.05) {
          items.push({
            kind: 'mass-drift',
            partId: row.id,
            label: row.label || row.part,
            link,
            partMassG: def.mass_g,
            linkMassKg: inertial?.mass ?? null
          })
        }
      }
    }
  }

  // --- orphans recorded at delete time ---------------------------------------
  for (const entry of model?.orphanedLinks ?? []) {
    // A modern delete records the exact link; a LEGACY delete (no urdfLink to
    // read) records the name the mint would have used, so tolerate the same
    // `_N` suffixes nameMatch does. Stale entries (link since removed/renamed)
    // and links a part legitimately re-claimed are silently skipped.
    const link =
      links.has(entry) && !claimed.has(entry) ? entry : nameMatch(links, claimed, entry)
    if (link) {
      claimed.add(link)
      items.push({ kind: 'orphan-link', link, ledger: entry })
    }
  }

  return items
}

/** The links the plan would flag red in the 3-D view (#626's orphan tint). */
export function orphanTintLinks(plan: SyncItem[]): string[] {
  return plan.filter((i): i is Extract<SyncItem, { kind: 'orphan-link' }> => i.kind === 'orphan-link').map((i) => i.link)
}

/** Re-add an orphaned link to Electronics (#626's third choice): the new part
 *  row, claiming the link. `lib`/`part` come from the dialog's picker (the link
 *  alone can't say which library part it was). Pure. */
export function reAddedPartRow(
  robot: RobotDefinition,
  link: string,
  lib: string,
  partId: string,
  label: string
): RobotPart {
  const ids = new Set(['board', ...robot.parts.map((p) => p.id)])
  let id = partId
  let n = 2
  while (ids.has(id)) id = `${partId}${n++}`
  return { id, lib, part: partId, label, urdfLink: link }
}

/** Drop a resolved orphan from the model's ledger (pure; empty list removed). */
export function clearOrphan(robot: RobotDefinition, link: string): RobotDefinition {
  const model = robot.robot
  if (!model?.orphanedLinks) return robot
  const rest = model.orphanedLinks.filter((l) => l !== link)
  const next = { ...model }
  if (rest.length) next.orphanedLinks = rest
  else delete next.orphanedLinks
  return { ...robot, robot: next }
}

/** A stable name for the board's Build link, minted like any part link. */
export function boardLinkName(urdf: string, boardDef: PartDefinition | undefined, boardId: string): string {
  return uniqueLinkName(urdf, boardDef?.name || boardId)
}
