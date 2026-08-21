import { describe, expect, it } from 'vitest'
import { computeSyncPlan, resolveBoardLink } from '../src/renderer/src/components/sync-plan'
import { addBoxLink, blankUrdf, parseAssembly } from '../src/renderer/src/components/robot-assembly'
import { flattenHierarchy, unifiedTree } from '../src/renderer/src/components/hierarchy-tree'
import type { RobotDefinition } from '../src/shared/robot'
import type { PartDefinition, PartLibraryWithParts } from '../src/shared/part'

/**
 * SYNC IS A FIXPOINT (#782 fault 2) — running it twice must produce the same
 * document.
 *
 * The reported document had `Pimoroni_Tiny_2350`, `_2` and `_3`: three
 * byte-identical bodies for one microcontroller. The `_N` suffixes are the
 * unique-name mint working correctly on a caller that should never have asked
 * for a second body, and the origins are identical because the board's body is
 * placed from `boardX`/`boardY`, which don't move between syncs.
 *
 * The cause is an ASYMMETRY in identity. A part row that loses its `urdfLink`
 * still recognises its own body by name; the board had no such fallback — its
 * only identity was `RobotModel.boardLink`, so a lost record meant "no body" and
 * the reconcile minted another. And the record is losable in ordinary use: it is
 * merged into robot.yml in MAIN seconds after the click, while any host that
 * hasn't reloaded yet writes its whole (pre-merge) document back on the next
 * canvas gesture.
 *
 * So these tests never let identification depend on the record: they drop it
 * between passes, which is the failure the user hit, and require the plan to be
 * empty and the document unchanged anyway.
 */

const tiny = {
  id: 'tiny2350',
  name: 'Pimoroni Tiny 2350',
  description: '',
  family: 'Microcontroller',
  dimensions: { width: 22.9, height: 18.3 }
} as PartDefinition

const matrix = {
  id: 'modulino-led-matrix',
  name: 'Modulino LED Matrix',
  description: '',
  family: 'Display',
  dimensions: { width: 41, height: 25 }
} as PartDefinition

const libs: PartLibraryWithParts[] = [
  { id: 'std', name: 'Std', parts: [tiny, matrix] } as PartLibraryWithParts
]

/** A fixed body origin — the board's never moves between syncs, which is why
 *  the duplicates in #782 were byte-identical. */
const AT: [number, number, number] = [0.05, -0.03, 0]

interface Project {
  robot: RobotDefinition
  urdf: string
}

/**
 * One reconcile pass: mint a body for every `missing-body` item exactly as
 * `SyncControl.addBody` does (footprint box at the mirrored position), and
 * record the link back onto robot.yml.
 *
 * `keepRecords: false` models the record being lost before the next pass — a
 * stale whole-document `robot:save` landing after the targeted merge.
 */
function syncPass(project: Project, keepRecords: boolean): Project {
  const plan = computeSyncPlan(project.robot, project.urdf, libs)
  let urdf = project.urdf
  let robot = project.robot
  for (const item of plan) {
    if (item.kind !== 'missing-body') continue
    const def =
      item.partId === 'board'
        ? libs[0].parts?.find((p) => p.id === robot.board)
        : (() => {
            const row = robot.parts.find((p) => p.id === item.partId)
            return libs[0].parts?.find((p) => p.id === row?.part)
          })()
    if (!def) continue
    const size: [number, number, number] = [
      (def.dimensions?.width ?? 20) / 1000,
      (def.dimensions?.height ?? 20) / 1000,
      0.012
    ]
    const made = addBoxLink(urdf, { linkBase: def.name, size, at: AT })
    urdf = made.urdf
    if (!keepRecords) continue
    robot =
      item.partId === 'board'
        ? { ...robot, robot: { ...(robot.robot ?? {}), version: 1, boardLink: made.link } }
        : {
            ...robot,
            parts: robot.parts.map((p) => (p.id === item.partId ? { ...p, urdfLink: made.link } : p))
          }
  }
  return { robot, urdf }
}

const project = (): Project => ({
  robot: {
    board: 'tiny2350',
    boardX: 40,
    boardY: 30,
    parts: [
      { id: 'matrix', lib: 'std', part: 'modulino-led-matrix', label: 'Modulino LED Matrix' }
    ],
    connections: []
  },
  urdf: blankUrdf('my_robot')
})

const linkNames = (urdf: string): string[] => parseAssembly(urdf).map((i) => i.link)

describe('the sync reconcile is a fixpoint (#782)', () => {
  it('a second pass adds nothing when the records survive', () => {
    const first = syncPass(project(), true)
    expect(linkNames(first.urdf)).toEqual(['base_link', 'Pimoroni_Tiny_2350', 'Modulino_LED_Matrix'])
    expect(computeSyncPlan(first.robot, first.urdf, libs)).toEqual([])
    expect(syncPass(first, true).urdf).toBe(first.urdf)
  })

  it('a second pass adds nothing when the records were LOST — the bug', () => {
    // Pass one makes the bodies; the record-back never lands. Before the fix the
    // board came back as `missing-body` and pass two minted
    // `Pimoroni_Tiny_2350_2` — the exact duplicate in the report.
    const first = syncPass(project(), false)
    expect(computeSyncPlan(first.robot, first.urdf, libs)).toEqual([])
    const second = syncPass(first, false)
    expect(second.urdf).toBe(first.urdf)
  })

  it('no number of record-losing passes can accumulate a duplicate body', () => {
    // The property, not one repetition: every link in the document stays unique
    // AND the set of links never grows past the first pass, however many times
    // the reconcile runs against a manifest that has forgotten everything.
    let p = syncPass(project(), false)
    const after = linkNames(p.urdf)
    for (let i = 0; i < 5; i++) p = syncPass(p, false)
    expect(linkNames(p.urdf)).toEqual(after)
    expect(new Set(after).size).toBe(after.length)
    // One body per component, plus the starter base — never a mint-suffixed
    // twin of one already there.
    expect(after).toHaveLength(3)
    expect(after.some((l) => after.some((o) => o !== l && o.startsWith(`${l}_`)))).toBe(false)
  })

  it('a recorded board link still wins over a name match', () => {
    // The fallback must not DEMOTE the record: an explicit link is still
    // authoritative, so a board deliberately bound to another link keeps it.
    const links = new Set(['base_link', 'Pimoroni_Tiny_2350', 'chassis'])
    expect(resolveBoardLink(links, new Set(), tiny, 'tiny2350', 'chassis')).toEqual({
      link: 'chassis',
      dangling: false
    })
    // A record naming a link that is GONE dangles, and says so, before falling
    // back — the dialog words those two cases differently.
    expect(resolveBoardLink(links, new Set(), tiny, 'tiny2350', 'vanished')).toEqual({
      link: 'Pimoroni_Tiny_2350',
      dangling: true
    })
  })

  it('the board name match cannot steal a link a part recorded', () => {
    // Claimed links are another row's body. A board whose part name happens to
    // match must come up empty rather than share it.
    const links = new Set(['base_link', 'Pimoroni_Tiny_2350'])
    const claimed = new Set(['Pimoroni_Tiny_2350'])
    expect(resolveBoardLink(links, claimed, tiny, 'tiny2350', undefined).link).toBeNull()
  })

  it('the hierarchy agrees with the plan about the board body', () => {
    // If the two disagreed, one workspace would draw the board's body while the
    // other offered to create it — which is how the duplicates got clicked.
    const first = syncPass(project(), false)
    const tree = unifiedTree({
      board: 'tiny2350',
      parts: first.robot.parts,
      urdf: first.urdf,
      libraries: libs
    })
    expect(flattenHierarchy(tree).find((n) => n.kind === 'board')?.link).toBe('Pimoroni_Tiny_2350')
  })
})
