import { describe, expect, it } from 'vitest'
import {
  BOARD_KEY,
  countComponents,
  countNodes,
  findHierarchyNode,
  flattenHierarchy,
  jointKey,
  linkKey,
  unifiedTree,
  type HierarchyNode
} from '../src/renderer/src/components/hierarchy-tree'
import { addBoxLink, blankUrdf, setInertial } from '../src/renderer/src/components/robot-assembly'
import type { RobotPart } from '../src/shared/robot'
import type { PartDefinition, PartLibraryWithParts } from '../src/shared/part'

/**
 * The unified Electronics ⇄ BUILD hierarchy (#718, epic #720).
 *
 * The first block migrates the old `browserTree` (#649) cases wholesale — the
 * carrier-nesting rules didn't change, and the degenerate ones (a dangling
 * `mountedOn`, a cycle) are exactly the ones that must keep not losing a row.
 * The rest covers the merge itself: urdfLink joins, orphaned links, joints and
 * mass badges.
 */

const part = (id: string, over?: Partial<RobotPart>): RobotPart => ({
  id,
  lib: 'std',
  part: id,
  ...over
})

const def = (id: string, name: string, over?: Partial<PartDefinition>): PartDefinition =>
  ({ id, name, description: '', family: 'Sensor', dimensions: { width: 20, height: 10 }, ...over }) as PartDefinition

const libsWith = (...parts: PartDefinition[]): PartLibraryWithParts[] => [
  { id: 'std', name: 'Std', parts } as PartLibraryWithParts
]

/** Keys of the top level, ignoring nesting. */
const keys = (nodes: HierarchyNode[]): string[] => nodes.map((n) => n.key)

// ---------------------------------------------------------------------------
// Migrated from browserTree.test.ts (#649) — carrier nesting is unchanged
// ---------------------------------------------------------------------------

describe('unifiedTree — the Electronics spine (migrated #649 browser-tree rules)', () => {
  it('keeps a flat project flat, board first', () => {
    const tree = unifiedTree({ board: 'Pico', parts: [part('a'), part('b')] })
    expect(keys(tree)).toEqual([BOARD_KEY, 'a', 'b'])
    expect(tree.every((n) => n.children.length === 0)).toBe(true)
  })

  it('nests a docked part under its carrier', () => {
    const tree = unifiedTree({ parts: [part('base'), part('servo1', { mountedOn: 'base' })] })
    expect(keys(tree)).toEqual(['base'])
    expect(keys(tree[0].children)).toEqual(['servo1'])
  })

  it('nests the MCU under the carrier it is seated in', () => {
    const tree = unifiedTree({
      board: 'XIAO RP2350',
      boardMountedOn: 'base1',
      parts: [part('base1', { label: 'XIAO Expansion Base' })]
    })
    expect(tree.map((n) => n.label)).toEqual(['XIAO Expansion Base'])
    expect(tree[0].children.map((n) => n.label)).toEqual(['XIAO RP2350'])
    expect(tree[0].children[0].kind).toBe('board')
  })

  it('nests more than one level deep', () => {
    const tree = unifiedTree({
      parts: [part('a'), part('b', { mountedOn: 'a' }), part('c', { mountedOn: 'b' })]
    })
    expect(keys(tree[0].children[0].children)).toEqual(['c'])
  })

  it('prefers a part label over the library part id', () => {
    const tree = unifiedTree({ parts: [part('p1', { label: 'Left wheel', part: 'n20-motor' })] })
    expect(tree[0].label).toBe('Left wheel')
    expect(unifiedTree({ parts: [part('p1', { part: 'n20-motor' })] })[0].label).toBe('n20-motor')
  })

  it('keeps a part whose carrier does not exist at the top level', () => {
    const tree = unifiedTree({ parts: [part('orphan', { mountedOn: 'gone' })] })
    expect(keys(tree)).toEqual(['orphan'])
  })

  it('a carrier cycle leaves both rows at the top level instead of recursing', () => {
    const tree = unifiedTree({
      parts: [part('a', { mountedOn: 'b' }), part('b', { mountedOn: 'a' })]
    })
    expect(keys(tree).sort()).toEqual(['a', 'b'])
    expect(countNodes(tree)).toBe(2)
  })

  it('ignores a part mounted on itself', () => {
    const tree = unifiedTree({ parts: [part('self', { mountedOn: 'self' })] })
    expect(keys(tree)).toEqual(['self'])
    expect(tree[0].children).toEqual([])
  })

  it('survives a longer cycle', () => {
    const tree = unifiedTree({
      parts: [part('a', { mountedOn: 'c' }), part('b', { mountedOn: 'a' }), part('c', { mountedOn: 'b' })]
    })
    expect(countNodes(tree)).toBe(3)
  })

  it('loses nothing: every row appears exactly once', () => {
    const parts = [
      part('base'),
      part('mcuish', { mountedOn: 'base' }),
      part('loose'),
      part('orphan', { mountedOn: 'nope' })
    ]
    const tree = unifiedTree({ board: 'Pico', boardMountedOn: 'base', parts })
    expect(countNodes(tree)).toBe(parts.length + 1)
    const rowKeys = flattenHierarchy(tree).map((n) => n.key)
    expect(new Set(rowKeys).size).toBe(rowKeys.length)
  })

  it('omits the board row when no board is chosen', () => {
    expect(unifiedTree({ parts: [part('a')] }).some((n) => n.kind === 'board')).toBe(false)
  })

  it('ignores boardMountedOn when it names a missing part', () => {
    expect(keys(unifiedTree({ board: 'Pico', boardMountedOn: 'gone', parts: [] }))).toEqual([BOARD_KEY])
  })

  it('countNodes counts every depth, not just the roots', () => {
    const tree = unifiedTree({
      parts: [part('a'), part('b', { mountedOn: 'a' }), part('c', { mountedOn: 'b' })]
    })
    expect(tree).toHaveLength(1)
    expect(countNodes(tree)).toBe(3)
  })

  it('a duplicate instance id keeps only the first row', () => {
    const tree = unifiedTree({ parts: [part('dup', { label: 'first' }), part('dup', { label: 'second' })] })
    expect(tree).toHaveLength(1)
    expect(tree[0].label).toBe('first')
  })

  it('resolves the MCU label from the part libraries when the host gives none', () => {
    const tree = unifiedTree({ board: 'xiao-rp2350', libraries: libsWith(def('xiao-rp2350', 'XIAO RP2350')) })
    expect(tree[0].label).toBe('XIAO RP2350')
  })
})

// ---------------------------------------------------------------------------
// The merge itself
// ---------------------------------------------------------------------------

/** A URDF with `base_link` plus one box link per name, each fixed to the base. */
function urdfWith(...names: string[]): string {
  let urdf = blankUrdf('bot')
  for (const n of names) urdf = addBoxLink(urdf, { linkBase: n, size: [0.02, 0.02, 0.01] }).urdf
  return urdf
}

describe('unifiedTree — joining Electronics to Build', () => {
  it('a part and its recorded link are ONE node, not two', () => {
    const urdf = urdfWith('SG90')
    const tree = unifiedTree({
      parts: [part('s1', { label: 'Left servo', urdfLink: 'SG90' })],
      urdf
    })
    const rows = flattenHierarchy(tree)
    // base_link (build-only) + the fixed joint + the part. No separate "SG90" row.
    expect(rows.filter((n) => n.label === 'SG90' && n.kind === 'link')).toHaveLength(0)
    const servo = findHierarchyNode(tree, 's1')
    expect(servo?.link).toBe('SG90')
    expect(servo?.kind).toBe('part')
    expect(servo?.buildOnly).toBe(false)
  })

  it('a legacy part with no urdfLink still name-matches its link', () => {
    const urdf = urdfWith('SG90')
    const tree = unifiedTree({
      parts: [part('s1', { part: 'sg90' })],
      urdf,
      libraries: libsWith(def('sg90', 'SG90'))
    })
    expect(findHierarchyNode(tree, 's1')?.link).toBe('SG90')
  })

  it('two rows of the same part never share one link — the clone comes up bodyless', () => {
    const urdf = urdfWith('SG90')
    const tree = unifiedTree({
      parts: [part('s1', { part: 'sg90' }), part('s2', { part: 'sg90' })],
      urdf,
      libraries: libsWith(def('sg90', 'SG90'))
    })
    expect(findHierarchyNode(tree, 's1')?.link).toBe('SG90')
    expect(findHierarchyNode(tree, 's2')?.link).toBeNull()
  })

  it('a link no part claims is a Build-only row, kept and flagged', () => {
    const urdf = urdfWith('bracket')
    const tree = unifiedTree({ parts: [], urdf })
    const bracket = findHierarchyNode(tree, linkKey('bracket'))
    expect(bracket?.kind).toBe('link')
    expect(bracket?.buildOnly).toBe(true)
    expect(bracket?.link).toBe('bracket')
  })

  it('a part nests under the link its joint hangs off', () => {
    const urdf = urdfWith('SG90')
    const tree = unifiedTree({ parts: [part('s1', { urdfLink: 'SG90' })], urdf })
    const base = findHierarchyNode(tree, linkKey('base_link'))
    expect(base?.isBase).toBe(true)
    expect(base?.children.map((n) => n.key)).toContain('s1')
  })

  it('a carrier beats the kinematic parent — a docked part stays inside its carrier', () => {
    // Both parts are jointed to base_link in the URDF, but the servo is docked
    // into the expansion base: authored intent wins, in BOTH workspaces.
    const urdf = urdfWith('ExpBase', 'SG90')
    const tree = unifiedTree({
      parts: [part('exp', { urdfLink: 'ExpBase' }), part('s1', { urdfLink: 'SG90', mountedOn: 'exp' })],
      urdf
    })
    expect(findHierarchyNode(tree, 'exp')?.children.map((n) => n.key)).toContain('s1')
  })

  it('the joint row sits directly above the row it attaches', () => {
    const urdf = urdfWith('SG90')
    const tree = unifiedTree({ parts: [part('s1', { urdfLink: 'SG90' })], urdf })
    const rows = flattenHierarchy(tree)
    const at = rows.findIndex((n) => n.key === 's1')
    expect(rows[at - 1].key).toBe(jointKey('SG90_joint'))
    expect(rows[at - 1].kind).toBe('joint')
    expect(rows[at - 1].buildOnly).toBe(true)
    expect(rows[at - 1].joint).toMatchObject({ parent: 'base_link', child: 'SG90', type: 'fixed' })
  })

  it('with no Build model at all, the tree is exactly the Electronics one', () => {
    const withUrdf = unifiedTree({ board: 'Pico', parts: [part('a')], urdf: '' })
    expect(keys(withUrdf)).toEqual([BOARD_KEY, 'a'])
    expect(withUrdf.every((n) => n.link === null && !n.buildOnly)).toBe(true)
  })

  it('records the MCU board link from the model, and only from there', () => {
    const urdf = urdfWith('XIAO')
    const linked = unifiedTree({ board: 'XIAO', boardLink: 'XIAO', urdf })
    expect(findHierarchyNode(linked, BOARD_KEY)?.link).toBe('XIAO')
    // A DANGLING record falls back to "no body" — never to a name guess, which
    // is what computeSyncPlan reports too, so the tree and the Sync badge agree.
    const dangling = unifiedTree({ board: 'XIAO', boardLink: 'gone', urdf })
    expect(findHierarchyNode(dangling, BOARD_KEY)?.link).toBeNull()
    expect(findHierarchyNode(dangling, linkKey('XIAO'))?.buildOnly).toBe(true)
  })

  it('a loose (unjointed) import is a root marked loose', () => {
    const urdf = `${blankUrdf('bot').replace('</robot>', '')}  <link name="stray"><visual><geometry><box size="1 1 1"/></geometry></visual></link>\n</robot>`
    const tree = unifiedTree({ urdf })
    const stray = findHierarchyNode(tree, linkKey('stray'))
    expect(stray?.loose).toBe(true)
    expect(keys(tree)).toContain(linkKey('stray'))
  })

  it('every component keeps the same key whichever workspace renders it', () => {
    // The keys are what a shared selection stores — they must be derived from
    // the model, not from the workspace.
    const urdf = urdfWith('SG90')
    const a = unifiedTree({ board: 'Pico', parts: [part('s1', { urdfLink: 'SG90' })], urdf })
    const b = unifiedTree({ board: 'Pico', parts: [part('s1', { urdfLink: 'SG90' })], urdf })
    expect(flattenHierarchy(a).map((n) => n.key)).toEqual(flattenHierarchy(b).map((n) => n.key))
  })

  it('counts components (board + parts) apart from total rows', () => {
    const urdf = urdfWith('SG90', 'bracket')
    const tree = unifiedTree({ board: 'Pico', parts: [part('s1', { urdfLink: 'SG90' })], urdf })
    expect(countComponents(tree)).toBe(2) // the MCU + the servo
    expect(countNodes(tree)).toBeGreaterThan(2) // …plus base_link, bracket, joints
  })
})

// ---------------------------------------------------------------------------
// Per-row mass (the badges' data)
// ---------------------------------------------------------------------------

describe('per-row mass', () => {
  /** `urdfWith` links, with `mass` kg written onto `link`. */
  const weighed = (urdf: string, link: string, kg: number): string =>
    setInertial(urdf, link, { mass: kg, com: [0, 0, 0] })

  it('a body with no inertial has a NULL mass — never a default', () => {
    const tree = unifiedTree({ parts: [part('s1', { urdfLink: 'SG90' })], urdf: urdfWith('SG90') })
    const servo = findHierarchyNode(tree, 's1')
    expect(servo?.massG).toBeNull()
    expect(servo?.massSource).toBe('none')
  })

  it('a part with no Build body at all has a null mass too', () => {
    const tree = unifiedTree({ parts: [part('s1')], urdf: '' })
    expect(findHierarchyNode(tree, 's1')?.massG).toBeNull()
  })

  it('a zero-gram inertial reads as UNKNOWN, not as weightless', () => {
    // No layer in Snakie lets a part declare 0 g; a 0 here is missing data, and
    // showing "0 g" would claim the part contributes nothing to the CoM.
    const urdf = weighed(urdfWith('SG90'), 'SG90', 0)
    expect(findHierarchyNode(unifiedTree({ parts: [part('s1', { urdfLink: 'SG90' })], urdf }), 's1')?.massG).toBeNull()
  })

  it('reads grams from the inertial and the provenance from robot.yml', () => {
    const urdf = weighed(urdfWith('SG90'), 'SG90', 0.009)
    const tree = unifiedTree({
      parts: [part('s1', { urdfLink: 'SG90' })],
      urdf,
      linkMass: { SG90: { source: 'library' } }
    })
    const servo = findHierarchyNode(tree, 's1')
    expect(servo?.massG).toBeCloseTo(9, 5)
    expect(servo?.massSource).toBe('library')
  })

  it('a stored mass with no recorded provenance counts as measured', () => {
    const urdf = weighed(urdfWith('SG90'), 'SG90', 0.009)
    const tree = unifiedTree({ parts: [part('s1', { urdfLink: 'SG90' })], urdf })
    expect(findHierarchyNode(tree, 's1')?.massSource).toBe('measured')
  })

  it('a joint row never carries a mass — it is not a body', () => {
    const urdf = weighed(urdfWith('SG90'), 'SG90', 0.009)
    const joints = flattenHierarchy(unifiedTree({ urdf })).filter((n) => n.kind === 'joint')
    expect(joints.length).toBeGreaterThan(0)
    expect(joints.every((n) => n.massG === null)).toBe(true)
  })
})
