import { describe, expect, it } from 'vitest'
import {
  boardLinkName,
  clearOrphan,
  computeSyncPlan,
  orphanTintLinks,
  reAddedPartRow,
  resolvePartLink
} from '../src/renderer/src/components/sync-plan'
import { addBoxLink, blankUrdf, setInertial } from '../src/renderer/src/components/robot-assembly'
import type { RobotDefinition } from '../src/shared/robot'
import type { PartDefinition, PartLibraryWithParts } from '../src/shared/part'

/**
 * Unit tests for the Electronics↔Build sync classifier (#717, epic #720): every
 * mismatch class, the urdfLink/dangling/name-match identity rules, and the
 * orphan ledger recorded at delete time.
 */

const sg90 = {
  id: 'sg90',
  name: 'SG90',
  description: '',
  family: 'Motor',
  dimensions: { width: 23, height: 12 },
  mass_g: 9
} as PartDefinition

const libs: PartLibraryWithParts[] = [
  { id: 'std', name: 'Std', parts: [sg90] } as PartLibraryWithParts
]

const robotWith = (over: Partial<RobotDefinition>): RobotDefinition => ({
  parts: [],
  connections: [],
  ...over
})

/** A URDF holding one box link named SG90 (what placement would have minted). */
function urdfWithSg90(): string {
  return addBoxLink(blankUrdf('bot'), { linkBase: 'SG90', size: [0.023, 0.012, 0.02] }).urdf
}

describe('resolvePartLink — identity rules (#716/#717)', () => {
  const links = new Set(['base_link', 'SG90'])
  const none = new Set<string>()
  const row = { id: 'sg90', lib: 'std', part: 'sg90' }

  it('a recorded link that exists is authoritative', () => {
    expect(resolvePartLink(links, none, sg90, { ...row, urdfLink: 'SG90' })).toEqual({
      link: 'SG90',
      dangling: false
    })
  })

  it('a dangling record falls back to the name match — and says it dangled', () => {
    expect(resolvePartLink(links, none, sg90, { ...row, urdfLink: 'gone' })).toEqual({
      link: 'SG90',
      dangling: true
    })
  })

  it('a legacy row (no record) name-matches, exact or _N-suffixed', () => {
    expect(resolvePartLink(links, none, sg90, row).link).toBe('SG90')
    expect(resolvePartLink(new Set(['SG90_2']), none, sg90, row).link).toBe('SG90_2')
    // A lookalike that is NOT a mint suffix must not match.
    expect(resolvePartLink(new Set(['SG90_arm']), none, sg90, row).link).toBeNull()
  })

  it('a name match never steals a CLAIMED link (the duplicated-part case)', () => {
    expect(resolvePartLink(links, new Set(['SG90']), sg90, row).link).toBeNull()
  })
})

describe('computeSyncPlan', () => {
  it('a placed part with no Build body is missing-body', () => {
    const plan = computeSyncPlan(
      robotWith({ parts: [{ id: 'sg90', lib: 'std', part: 'sg90' }] }),
      blankUrdf('bot'),
      libs
    )
    expect(plan).toEqual([
      { kind: 'missing-body', partId: 'sg90', label: 'sg90', dangling: false }
    ])
  })

  it('no URDF at all ⇒ every part is missing-body', () => {
    const plan = computeSyncPlan(
      robotWith({ parts: [{ id: 'sg90', lib: 'std', part: 'sg90' }] }),
      null,
      libs
    )
    expect(plan.map((i) => i.kind)).toEqual(['missing-body'])
  })

  it('a part whose link resolves produces no missing-body', () => {
    const urdf = urdfWithSg90()
    const withMass = setInertial(urdf, 'SG90', { mass: 0.009, com: [0, 0, 0.01] })
    const plan = computeSyncPlan(
      robotWith({ parts: [{ id: 'sg90', lib: 'std', part: 'sg90', urdfLink: 'SG90' }] }),
      withMass,
      libs
    )
    expect(plan).toEqual([])
  })

  it('the MCU board without a boardLink is missing-body as "board"', () => {
    const plan = computeSyncPlan(robotWith({ board: 'sg90' }), blankUrdf('bot'), libs)
    expect(plan).toEqual([{ kind: 'missing-body', partId: 'board', label: 'SG90', dangling: false }])
  })

  it('a recorded boardLink that exists satisfies the board', () => {
    const plan = computeSyncPlan(
      robotWith({ board: 'sg90', robot: { version: 1, boardLink: 'SG90' } }),
      urdfWithSg90(),
      libs
    )
    expect(
      plan.filter((i) => ('partId' in i && i.partId === 'board') || i.kind === 'missing-body')
    ).toEqual([])
  })

  it('a box body whose part now ships a mesh is placeholder-upgradable', () => {
    const meshLibs: PartLibraryWithParts[] = [
      { id: 'std', name: 'Std', parts: [{ ...sg90, mesh: 'model.stl' }] } as PartLibraryWithParts
    ]
    const urdf = setInertial(urdfWithSg90(), 'SG90', { mass: 0.009, com: [0, 0, 0] })
    const plan = computeSyncPlan(
      robotWith({ parts: [{ id: 'sg90', lib: 'std', part: 'sg90', urdfLink: 'SG90' }] }),
      urdf,
      meshLibs
    )
    expect(plan).toEqual([
      { kind: 'placeholder-upgradable', partId: 'sg90', label: 'sg90', link: 'SG90' }
    ])
  })

  it('library mass vs the link inertial is mass-drift — with the numbers', () => {
    const plan = computeSyncPlan(
      robotWith({ parts: [{ id: 'sg90', lib: 'std', part: 'sg90', urdfLink: 'SG90' }] }),
      urdfWithSg90(), // no inertial at all
      libs
    )
    expect(plan).toEqual([
      {
        kind: 'mass-drift',
        partId: 'sg90',
        label: 'sg90',
        link: 'SG90',
        partMassG: 9,
        linkMassKg: null
      }
    ])
  })

  it('a MEASURED link mass is never second-guessed by the library number', () => {
    const urdf = setInertial(urdfWithSg90(), 'SG90', { mass: 0.02, com: [0, 0, 0] })
    const plan = computeSyncPlan(
      robotWith({
        parts: [{ id: 'sg90', lib: 'std', part: 'sg90', urdfLink: 'SG90' }],
        robot: { version: 1, linkMass: { SG90: { source: 'measured' } } }
      }),
      urdf,
      libs
    )
    expect(plan).toEqual([])
  })

  it('an orphan recorded at delete time surfaces while its link survives', () => {
    const plan = computeSyncPlan(
      robotWith({ robot: { version: 1, orphanedLinks: ['SG90', 'long_gone'] } }),
      urdfWithSg90(),
      libs
    )
    expect(plan).toEqual([{ kind: 'orphan-link', link: 'SG90', ledger: 'SG90' }])
    expect(orphanTintLinks(plan)).toEqual(['SG90'])
  })

  it('an orphan re-claimed by a part is not an orphan any more', () => {
    const urdf = setInertial(urdfWithSg90(), 'SG90', { mass: 0.009, com: [0, 0, 0] })
    const plan = computeSyncPlan(
      robotWith({
        parts: [{ id: 'sg90', lib: 'std', part: 'sg90', urdfLink: 'SG90' }],
        robot: { version: 1, orphanedLinks: ['SG90'] }
      }),
      urdf,
      libs
    )
    expect(plan).toEqual([])
  })
})

describe('orphan ledger helpers', () => {
  it('clearOrphan removes one entry, dropping the empty list entirely', () => {
    const robot = robotWith({ robot: { version: 1, orphanedLinks: ['A', 'B'] } })
    const once = clearOrphan(robot, 'A')
    expect(once.robot?.orphanedLinks).toEqual(['B'])
    expect(clearOrphan(once, 'B').robot?.orphanedLinks).toBeUndefined()
  })

  it('reAddedPartRow claims the link with a fresh unique id', () => {
    const robot = robotWith({ parts: [{ id: 'sg90', lib: 'std', part: 'sg90' }] })
    const row = reAddedPartRow(robot, 'SG90_2', 'std', 'sg90', 'SG90')
    expect(row).toEqual({ id: 'sg902', lib: 'std', part: 'sg90', label: 'SG90', urdfLink: 'SG90_2' })
  })

  it('boardLinkName mints from the board part name, unique in the URDF', () => {
    expect(boardLinkName(urdfWithSg90(), sg90, 'sg90')).toBe('SG90_2')
    expect(boardLinkName(blankUrdf('bot'), undefined, 'pico2w')).toBe('pico2w')
  })
})

describe('orphanedLinks round-trips robot.yml (#717 whitelist)', () => {
  it('survives save → load through the sanitiser', async () => {
    const { robotToYaml, robotFromYaml } = await import('../src/shared/robot-yaml')
    const yaml = robotToYaml(
      robotWith({ robot: { version: 1, orphanedLinks: ['SG90'], boardLink: 'pico2w' } })
    )
    const back = robotFromYaml(yaml)
    expect(back.robot?.orphanedLinks).toEqual(['SG90'])
    expect(back.robot?.boardLink).toBe('pico2w')
  })
})

describe('review-fix coverage (#717 adversarial pass)', () => {
  it('a duplicated part (link-less clone) is offered its OWN body, not the original’s', () => {
    const urdf = setInertial(urdfWithSg90(), 'SG90', { mass: 0.009, com: [0, 0, 0] })
    const plan = computeSyncPlan(
      robotWith({
        parts: [
          { id: 'sg90', lib: 'std', part: 'sg90', urdfLink: 'SG90' },
          { id: 'sg902', lib: 'std', part: 'sg90' } // the clone — urdfLink stripped
        ]
      }),
      urdf,
      libs
    )
    expect(plan).toEqual([
      { kind: 'missing-body', partId: 'sg902', label: 'sg90', dangling: false }
    ])
  })

  it('mass within the writers’ 0.1 g quantum is NOT drift (no phantom items)', () => {
    // mass_g 9.15 writes as 0.0092 kg (4-dp fmtNum): must satisfy the plan.
    const fine = { ...sg90, mass_g: 9.15 } as PartDefinition
    const fineLibs: PartLibraryWithParts[] = [
      { id: 'std', name: 'Std', parts: [fine] } as PartLibraryWithParts
    ]
    const urdf = setInertial(urdfWithSg90(), 'SG90', { mass: 0.0092, com: [0, 0, 0] })
    const plan = computeSyncPlan(
      robotWith({ parts: [{ id: 'sg90', lib: 'std', part: 'sg90', urdfLink: 'SG90' }] }),
      urdf,
      fineLibs
    )
    expect(plan).toEqual([])
  })

  it('a legacy delete’s name GUESS resolves to the minted _N link', () => {
    // The ledger holds the base name; the actual link was minted as SG90_2.
    const urdf = addBoxLink(urdfWithSg90(), { linkBase: 'SG90', size: [0.01, 0.01, 0.01] }).urdf
    const plan = computeSyncPlan(
      robotWith({
        parts: [{ id: 'keep', lib: 'std', part: 'sg90', urdfLink: 'SG90' }],
        robot: { version: 1, orphanedLinks: ['SG90'] }
      }),
      setInertial(urdf, 'SG90', { mass: 0.009, com: [0, 0, 0] }),
      libs
    )
    // 'SG90' itself is claimed by the surviving part, so the guess lands on SG90_2.
    expect(plan).toEqual([{ kind: 'orphan-link', link: 'SG90_2', ledger: 'SG90' }])
  })

  it('swapLinkVisualToMesh keeps the joint, children and inertial intact', async () => {
    const { swapLinkVisualToMesh, readInertial: read, readJoint } = await import(
      '../src/renderer/src/components/robot-assembly'
    )
    let urdf = urdfWithSg90()
    urdf = setInertial(urdf, 'SG90', { mass: 0.009, com: [0, 0, 0.01] })
    // A child jointed BELOW the placeholder — must survive the upgrade.
    urdf = addBoxLink(urdf, { linkBase: 'horn', size: [0.005, 0.005, 0.005], parent: 'SG90' }).urdf
    const before = readJoint(urdf, 'SG90')
    const next = swapLinkVisualToMesh(urdf, 'SG90', 'meshes/sg90.stl', 0.001)
    expect(next).toContain('meshes/sg90.stl')
    // The SG90 link BLOCK itself holds no box any more (the horn's box may).
    const block = /<link name="SG90">[\s\S]*?<\/link>/.exec(next)![0]
    expect(block).not.toContain('<box')
    expect(block).toContain('meshes/sg90.stl')
    expect(read(next, 'SG90')).toEqual({ mass: 0.009, com: [0, 0, 0.01] }) // inertial kept
    expect(readJoint(next, 'SG90')).toEqual(before) // joint untouched
    expect(readJoint(next, 'horn')?.parent).toBe('SG90') // child survives
  })
})
