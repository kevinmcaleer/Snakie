/**
 * THE UNIFIED ELECTRONICS ⇄ BUILD HIERARCHY (#718, epic #720) — pure, DOM-free.
 *
 * Snakie used to grow two component trees that described the same robot and
 * disagreed about it: the Board View's browser (board + placed parts, nested by
 * CARRIER) and the Build panel's chain (URDF links + joints, nested by JOINT).
 * This module merges them into ONE node list that both workspaces render, so the
 * hierarchy reads identically wherever you are.
 *
 * The join is `RobotPart.urdfLink` (#716) — resolved through the very same
 * {@link resolvePartLink} the sync plan uses, so the hierarchy and the Sync
 * badge can never disagree about which link is a part's body. **A part and its
 * link are ONE node**, not two: the row carries both the Electronics id and the
 * Build link, and clicking it selects/zooms in whichever workspace you're in.
 *
 * Nesting, in priority order:
 *   1. the CARRIER a part is seated in (`mountedOn` / `boardMountedOn`) — that's
 *      user-authored physical intent, and a XIAO belongs inside its expansion
 *      base in both workspaces;
 *   2. else the KINEMATIC parent (the parent link of the joint whose child is
 *      this node's link) — which is what makes the Build chain readable;
 *   3. else a root.
 *
 * Nodes that exist only in Build (structural links) are flagged `buildOnly`; per
 * the epic's decision they render DIMMED AND INERT in Electronics rather than
 * being hidden, so the tree structure is identical.
 *
 * JOINTS ARE NOT ROWS (#720). They were, briefly — one row per joint, directly
 * above the row it attached — and that doubled the length of every list for
 * information that is structural noise. A joint is now a PROPERTY of the body it
 * attaches: `node.joint` is the joint whose child is this node's link (null for
 * the base, for a loose import, for anything with no 3-D body), and the panel
 * draws it as an icon on the row. Because a URDF body has at most one parent
 * joint, that is exactly ONE icon per joint, carried by the child — every joint
 * in the model is still reachable, and reachable in only one place. The other
 * end of the relationship is `jointedChildren`: how many bodies hang off this
 * one, which are precisely the rows nested underneath it.
 *
 * Deliberately total, like the browser tree it replaces: a dangling `mountedOn`
 * or a carrier cycle leaves a node at the top level rather than losing it or
 * recursing forever.
 *
 * MASS (#719) is read here too and NEVER invented: a link with no usable
 * `<inertial>` gets `massG: null` (the "?" badge), never a default or a zero
 * that could masquerade as a weighed part.
 */
import type { PartLibraryWithParts } from '../../../shared/part'
import type { LinkMassSpec, RobotPart } from '../../../shared/robot'
import {
  buildChainTree,
  effectiveBaseLink,
  parseAssembly,
  readAllJoints,
  readInertial,
  type JointType
} from './robot-assembly'
import type { MassSource } from './robot-mass'
import { resolveDef, resolvePartLink } from './sync-plan'

/** The key the microcontroller row uses (matches the wiring canvas subject key). */
export const BOARD_KEY = 'board'

/** Which workspace is rendering the tree — decides what is inert, not what exists. */
export type HierarchyWorkspace = 'electronics' | 'build'

/**
 * What a row IS. Every row is a BODY — there is no joint row (#720).
 *  - `board` — the microcontroller (an Electronics row, possibly with a link)
 *  - `part`  — a placed library part (ditto)
 *  - `link`  — a URDF link with no Electronics part: a structural block, an
 *              imported STL, an orphan. Build-only.
 */
export type HierarchyKind = 'board' | 'part' | 'link'

/** The joint a row carries — the one that attaches its body to its parent. */
export interface HierarchyJoint {
  name: string
  type: JointType
  parent: string
  child: string
}

/** One row of the unified hierarchy. */
export interface HierarchyNode {
  /**
   * Stable, workspace-independent selection key — this is what a shared
   * selection stores, so it must not change when you switch workspace.
   * `'board'` for the MCU, the instance id for a placed part, `link:<name>` for
   * a Build-only row (namespaced so it can't collide with a part id).
   */
  key: string
  label: string
  kind: HierarchyKind
  /** The URDF link holding this row's 3-D body — null when it has none yet. */
  link: string | null
  /** The Electronics row id (`'board'` for the MCU); null for a Build-only row. */
  partId: string | null
  /**
   * The joint that attaches this row's body to its parent — **null when it has
   * none**: the base, a loose import, a part with no 3-D body yet. This is the
   * joint the row's joint icon shows and opens.
   */
  joint: HierarchyJoint | null
  /** How many OTHER bodies are jointed to this one (it is their parent). Those
   *  are the rows nested under it, each carrying its own joint. */
  jointedChildren: number
  /** True when this row exists only in Build — dimmed + inert in Electronics. */
  buildOnly: boolean
  /** This link is the kinematic base (the anchor everything hangs off). */
  isBase: boolean
  /** A Build-only link that isn't reachable from the base — a stray import. */
  loose: boolean
  /** Visual geometry of the link, for the row glyph. */
  geometry: 'mesh' | 'primitive' | 'none'
  /** Grams — or **null when no mass is known**. Never 0-as-known (#719). */
  massG: number | null
  massSource: MassSource
  children: HierarchyNode[]
}

export interface UnifiedTreeInput {
  /** The chosen microcontroller's id (`RobotDefinition.board`); undefined when
   *  no board is chosen and the MCU row doesn't exist. */
  board?: string
  /** The MCU's display name when the host already resolved it (a built-in board
   *  definition isn't always a library part). Falls back to the library part's
   *  name, then to the raw id. */
  boardLabel?: string
  /** The part instance the MCU is seated in (`RobotDefinition.boardMountedOn`). */
  boardMountedOn?: string
  /** The MCU's recorded Build link (`RobotModel.boardLink`). */
  boardLink?: string
  parts?: readonly RobotPart[]
  /** The project URDF text; empty/absent ⇒ no Build model yet. */
  urdf?: string | null
  /** Installed libraries, to resolve a part's definition (its name, its mesh). */
  libraries?: readonly PartLibraryWithParts[]
  /** `RobotModel.linkMass` — how each link's mass was authored. */
  linkMass?: Record<string, LinkMassSpec>
  /** The user's chosen base link (`RobotModel.baseLink`), if still a root. */
  baseLink?: string | null
}

/** The selection key of a Build-only link row. */
export const linkKey = (link: string): string => `link:${link}`

/** The label a placed part shows: its own label, else the library part id. */
function partLabel(p: RobotPart): string {
  return p.label || p.part
}

/**
 * Build the one hierarchy both workspaces render.
 *
 * `urdf` may be empty (a project with no Build model): then every part row
 * simply has `link: null`, no Build-only rows exist, and the tree degenerates
 * to exactly the old Electronics browser tree.
 */
export function unifiedTree(input: UnifiedTreeInput): HierarchyNode[] {
  const urdf = input.urdf ?? ''
  const parts = input.parts ?? []
  const libraries = input.libraries ?? []

  // --- the Build model -------------------------------------------------------
  const assembly = parseAssembly(urdf)
  const joints = readAllJoints(urdf)
  const links = new Set(assembly.map((i) => i.link))
  const base = effectiveBaseLink(urdf, input.baseLink)
  // buildChainTree gives the kinematic walk: document-ordered, cycle-safe, and
  // already knows which links are loose. Reused rather than re-derived so the
  // Build tree keeps behaving exactly as it did.
  const chain = buildChainTree(assembly, joints, base)
  const chainInfo = new Map(chain.map((c) => [c.link, c]))
  const geomOf = new Map<string, HierarchyNode['geometry']>(
    assembly.map((it) => [it.link, it.kind === 'mesh' ? 'mesh' : it.kind === 'none' ? 'none' : 'primitive'])
  )
  const geomFor = (link: string | null): HierarchyNode['geometry'] =>
    (link ? geomOf.get(link) : undefined) ?? 'none'
  /** The joint whose CHILD is this link (its attachment to its parent). */
  const jointOfChild = new Map<string, HierarchyJoint>()
  /** How many joints hang a body off this link (this link is the parent). */
  const childrenOfLink = new Map<string, number>()
  for (const j of joints) {
    if (!j.child) continue
    // A joint pointing at a link that isn't in the model attaches nothing, and
    // must not inflate a row's connection count.
    if (links.has(j.child) && links.has(j.parent)) {
      childrenOfLink.set(j.parent, (childrenOfLink.get(j.parent) ?? 0) + 1)
    }
    if (jointOfChild.has(j.child)) continue // a body has ONE parent joint: the first wins
    jointOfChild.set(j.child, { name: j.name, type: j.type, parent: j.parent, child: j.child })
  }
  /** A body's joints, as the rows carry them (#720) — no joint has its own row. */
  const jointsOf = (link: string | null): { joint: HierarchyJoint | null; jointedChildren: number } => ({
    joint: (link ? jointOfChild.get(link) : undefined) ?? null,
    jointedChildren: (link ? childrenOfLink.get(link) : undefined) ?? 0
  })

  // --- who owns which link ---------------------------------------------------
  // Claims resolve in the SAME trust order computeSyncPlan uses: recorded links
  // first (board, then parts), then legacy name-matches over what's left — so a
  // name-match can never steal a link another row explicitly recorded.
  const claimed = new Set<string>()
  const boardLink = input.boardLink && links.has(input.boardLink) ? input.boardLink : null
  if (boardLink) claimed.add(boardLink)
  for (const row of parts) {
    if (row.urdfLink && links.has(row.urdfLink)) claimed.add(row.urdfLink)
  }
  const linkOfPart = new Map<string, string | null>()
  const ownerOfLink = new Map<string, string>()
  if (boardLink) ownerOfLink.set(boardLink, BOARD_KEY)
  for (const row of parts) {
    if (linkOfPart.has(row.id)) continue // duplicate id — the first row keeps the link
    const def = resolveDef(libraries, row.lib, row.part)
    const { link } = resolvePartLink(links, claimed, def, row)
    if (link) {
      claimed.add(link)
      ownerOfLink.set(link, row.id)
    }
    linkOfPart.set(row.id, link)
  }

  // --- the rows --------------------------------------------------------------
  const massOf = (link: string | null): { massG: number | null; massSource: MassSource } => {
    if (!link) return { massG: null, massSource: 'none' }
    const inertial = readInertial(urdf, link)
    // A non-positive mass is NOT a known mass — #719's "no invented numbers"
    // cuts both ways: a 0 g body must read as unknown, not as weightless.
    if (!inertial || !(inertial.mass > 0)) return { massG: null, massSource: 'none' }
    // A stored inertial with no recorded provenance was typed by hand — the same
    // reading the Build panel's mass table has always taken.
    return { massG: inertial.mass * 1000, massSource: input.linkMass?.[link]?.source ?? 'measured' }
  }

  const nodes = new Map<string, HierarchyNode>()
  const order: string[] = []
  const add = (node: HierarchyNode): void => {
    if (nodes.has(node.key)) return
    nodes.set(node.key, node)
    order.push(node.key)
  }

  if (input.board) {
    add({
      key: BOARD_KEY,
      label: input.boardLabel || resolveDef(libraries, undefined, input.board)?.name || input.board,
      kind: 'board',
      link: boardLink,
      partId: BOARD_KEY,
      ...jointsOf(boardLink),
      buildOnly: false,
      isBase: !!boardLink && chainInfo.get(boardLink)?.isBase === true,
      loose: !!boardLink && chainInfo.get(boardLink)?.loose === true,
      geometry: geomFor(boardLink),
      ...massOf(boardLink),
      children: []
    })
  }
  for (const row of parts) {
    const link = linkOfPart.get(row.id) ?? null
    add({
      key: row.id,
      label: partLabel(row),
      kind: 'part',
      link,
      partId: row.id,
      ...jointsOf(link),
      buildOnly: false,
      isBase: !!link && chainInfo.get(link)?.isBase === true,
      loose: !!link && chainInfo.get(link)?.loose === true,
      geometry: geomFor(link),
      ...massOf(link),
      children: []
    })
  }
  // Build-only links, in the kinematic walk's order (base subtree first, then
  // anything loose) so the Build side reads exactly as its chain always has.
  for (const c of chain) {
    if (claimed.has(c.link)) continue
    add({
      key: linkKey(c.link),
      label: c.link,
      kind: 'link',
      link: c.link,
      partId: null,
      ...jointsOf(c.link),
      buildOnly: true,
      isBase: c.isBase,
      loose: c.loose,
      geometry: geomFor(c.link),
      ...massOf(c.link),
      children: []
    })
  }

  // --- parenting -------------------------------------------------------------
  const keyForLink = (link: string): string | undefined =>
    ownerOfLink.get(link) ?? (links.has(link) ? linkKey(link) : undefined)
  const parentOf = new Map<string, string>()
  const link2 = (child: string, parent: string | undefined): void => {
    if (!parent || parent === child || !nodes.has(parent)) return
    parentOf.set(child, parent)
  }
  /** Carrier first (authored intent), else the kinematic parent. */
  const attach = (key: string, carrier: string | undefined, ownLink: string | null): void => {
    if (carrier && nodes.has(carrier)) return link2(key, carrier)
    const j = ownLink ? jointOfChild.get(ownLink) : undefined
    if (j) link2(key, keyForLink(j.parent))
  }
  if (input.board) attach(BOARD_KEY, input.boardMountedOn, boardLink)
  for (const row of parts) attach(row.id, row.mountedOn, linkOfPart.get(row.id) ?? null)
  for (const c of chain) {
    if (claimed.has(c.link)) continue
    attach(linkKey(c.link), undefined, c.link)
  }

  /** Does following `key`'s parents lead back to `key`? (A ⊂ B ⊂ A.) */
  const inCycle = (key: string): boolean => {
    const seen = new Set<string>([key])
    let at = parentOf.get(key)
    while (at !== undefined) {
      if (at === key) return true
      if (seen.has(at)) return false // a loop that doesn't include `key`
      seen.add(at)
      at = parentOf.get(at)
    }
    return false
  }

  const roots: HierarchyNode[] = []
  for (const key of order) {
    const node = nodes.get(key) as HierarchyNode
    const parent = parentOf.get(key)
    const into = parent === undefined || inCycle(key) ? roots : (nodes.get(parent) as HierarchyNode).children
    // One row per BODY (#720). The joint that attaches this row used to be a row
    // of its own, directly above; it now rides on `node.joint` as an icon.
    into.push(node)
  }
  return roots
}

/** Every row of a tree, depth-first, in render order. */
export function flattenHierarchy(nodes: readonly HierarchyNode[]): HierarchyNode[] {
  const out: HierarchyNode[] = []
  const walk = (list: readonly HierarchyNode[]): void => {
    for (const n of list) {
      out.push(n)
      walk(n.children)
    }
  }
  walk(nodes)
  return out
}

/** Find a row by its selection key, at any depth (null when it's gone). */
export function findHierarchyNode(
  nodes: readonly HierarchyNode[],
  key: string | null | undefined
): HierarchyNode | null {
  if (!key) return null
  return flattenHierarchy(nodes).find((n) => n.key === key) ?? null
}

/** Total rows in a tree, at any depth. */
export function countNodes(nodes: readonly HierarchyNode[]): number {
  return flattenHierarchy(nodes).length
}

/** The COMPONENT rows — the board + placed parts. The browser's "Components"
 *  count has always meant this, and it stays the same number in both
 *  workspaces (Build-only rows are structure, not components). */
export function countComponents(nodes: readonly HierarchyNode[]): number {
  return flattenHierarchy(nodes).filter((n) => n.kind === 'board' || n.kind === 'part').length
}

// ---------------------------------------------------------------------------
// Mass coverage (#719) — honesty about how much of the robot is actually weighed
// ---------------------------------------------------------------------------

/** How much of the robot's mass is actually known. */
export interface MassCoverage {
  /** Bodies whose mass IS known (a positive `<inertial>` mass). */
  known: number
  /** Bodies in the hierarchy — the board, placed parts and structural links. */
  total: number
  /** Grams across the KNOWN bodies only. Never includes a guess. */
  knownG: number
  /** Every body has a known mass (and there is at least one body). */
  complete: boolean
}

/**
 * Count what the CoM is actually computed from (#719).
 *
 * Counted over the hierarchy's BODY rows — the board, placed parts and
 * structural links — never over raw URDF links: a part and its link are ONE
 * body and must not be counted twice, which is exactly what "use the placement
 * mapping, not the links" means. Since #720 every row IS a body (joints are a
 * property of the row they attach, not rows), so this counts rows.
 * A part with no Build body at all still counts as an UNWEIGHED body: it is
 * part of the robot, and its missing mass is precisely what the CoM leaves out.
 *
 * Pure. `known` counts what the CoM sums; `total - known` is what it silently
 * omits.
 */
export function massCoverage(nodes: readonly HierarchyNode[]): MassCoverage {
  let known = 0
  let total = 0
  let knownG = 0
  for (const n of flattenHierarchy(nodes)) {
    total += 1
    if (n.massG != null && n.massG > 0) {
      known += 1
      knownG += n.massG
    }
  }
  return { known, total, knownG, complete: total > 0 && known === total }
}

/**
 * The coverage sentence, or null when there's nothing to be honest about (an
 * empty project). Deliberately the SAME shape at every coverage level — "0 of
 * 12" is as informative as "4 of 12", and dropping the numbers at the extremes
 * is how a partial CoM starts looking authoritative.
 */
export function coverageLabel(c: MassCoverage): string | null {
  if (c.total === 0) return null
  const noun = c.total === 1 ? 'part' : 'parts'
  return `mass known for ${c.known} of ${c.total} ${noun}`
}
