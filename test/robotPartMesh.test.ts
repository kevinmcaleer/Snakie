import { describe, it, expect } from 'vitest'
import { safeUrdfName } from '../src/renderer/src/components/robot-part-mesh'

describe('safeUrdfName — the part-drop URDF write guard (#406)', () => {
  it('accepts a bare in-project relative URDF name', () => {
    expect(safeUrdfName('robot.urdf')).toBe(true)
    expect(safeUrdfName('robot-2.urdf')).toBe(true)
    expect(safeUrdfName('robots/arm.urdf')).toBe(true) // a subfolder is still in-project
  })
  it('rejects an escaping / absolute robot.yml urdf: so a drop can’t write outside the project', () => {
    expect(safeUrdfName('../../evil.urdf')).toBe(false)
    expect(safeUrdfName('a/../../evil.urdf')).toBe(false)
    expect(safeUrdfName('/etc/evil.urdf')).toBe(false)
    expect(safeUrdfName('C:\\evil.urdf')).toBe(false)
    expect(safeUrdfName('..')).toBe(false)
    expect(safeUrdfName('')).toBe(false)
  })
})

import {
  mirroredOrigin,
  partBodyPlan,
  partInertial,
  placeholderBoxSpec
} from '../src/renderer/src/components/robot-part-mesh'
import {
  addBoxLink,
  addMeshLink,
  blankUrdf,
  jointNames,
  movableJointNames,
  readInertial,
  setInertial
} from '../src/renderer/src/components/robot-assembly'
import { canvasPxPerMm, planPartAdditions } from '../src/renderer/src/components/project-parts'
import { robotFromYaml, robotToYaml } from '../src/shared/robot-yaml'
import type { PartDefinition } from '../src/shared/part'

/** A minimal part for the placement tests (#716). */
const part = (over: Partial<PartDefinition> = {}): PartDefinition =>
  ({
    id: 'pico2w',
    name: 'Pico 2 W',
    description: '',
    family: 'Microcontroller',
    dimensions: { width: 51, height: 21 },
    pcbColor: '#1b4d3e',
    ...over
  }) as PartDefinition

describe('placeholderBoxSpec — the footprint stand-in (#716)', () => {
  it('extrudes the real 2-D dimensions (mm) into metres', () => {
    const box = placeholderBoxSpec(part())
    expect(box.size[0]).toBeCloseTo(0.051)
    expect(box.size[1]).toBeCloseTo(0.021)
    expect(box.size[2]).toBeCloseTo(0.012) // default slab height
  })

  it('gives batteries and motors their taller family heights', () => {
    expect(placeholderBoxSpec(part({ family: 'Power' })).size[2]).toBeCloseTo(0.015)
    expect(placeholderBoxSpec(part({ family: 'Motor' })).size[2]).toBeCloseTo(0.02)
    expect(placeholderBoxSpec(part({ family: 'Carrier' })).size[2]).toBeCloseTo(0.014)
  })

  it('falls back to a 20 mm square for a part with no dimensions', () => {
    const box = placeholderBoxSpec(part({ dimensions: undefined }))
    expect(box.size[0]).toBeCloseTo(0.02)
    expect(box.size[1]).toBeCloseTo(0.02)
  })

  it('pulls the PCB colour toward grey — recognisable but visibly a stand-in', () => {
    const { rgb } = placeholderBoxSpec(part())
    // #1b4d3e ≈ (0.106, 0.302, 0.243); 40% toward 0.5 lifts every channel.
    expect(rgb[0]).toBeGreaterThan(0.106)
    expect(rgb[1]).toBeGreaterThan(0.302)
    expect(rgb[2]).toBeGreaterThan(0.243)
    expect(placeholderBoxSpec(part({ pcbColor: undefined })).rgb).toEqual([0.55, 0.55, 0.55])
  })
})

/**
 * THE #787 REGRESSION. A part that declares a `mesh:` whose file is absent must
 * not quietly produce a box.
 *
 * The 9V battery had `mesh: battery-9v.stl` in its `parts.yml` and no `.stl` in
 * its folder. Every consumer treated that exactly like a part with no model at
 * all: `attachPartBody` asked only "did the copy hand back a rel?", got nothing,
 * and dropped a footprint box without a word. The result looked like a
 * *rendering* bug, and finding out otherwise took a filesystem listing.
 *
 * The box itself is not the mistake — a part with no body is worse than one with
 * a stand-in. The silence is. So the rule under test is a two-sided one:
 * silence for a part that never had a model, and something to say for one whose
 * model is broken.
 */
describe('partBodyPlan — box vs mesh, and when to say so (#787)', () => {
  it('takes the copied mesh when there is one', () => {
    expect(partBodyPlan(part({ mesh: 'battery-9v.stl' }), { rel: 'meshes/battery-9v.stl' })).toEqual(
      { body: 'mesh', meshRel: 'meshes/battery-9v.stl' }
    )
  })

  it('boxes a part with NO model, and says nothing — that is most of the library', () => {
    // Noise on every drop of every meshless part is how a real warning gets
    // ignored, so this half of the rule matters as much as the other.
    for (const p of [part(), part({ mesh: '' }), part({ mesh: '   ' })]) {
      expect(partBodyPlan(p, null)).toEqual({ body: 'box' })
      expect(partBodyPlan(p, { error: 'no such file' })).toEqual({ body: 'box' })
    }
  })

  it('boxes a part whose DECLARED model is missing — but reports it', () => {
    const plan = partBodyPlan(part({ mesh: 'battery-9v.stl', name: '9V Battery' }), null)
    expect(plan.body).toBe('box') // still gets a body
    const problem = (plan as { problem?: string }).problem
    expect(problem, 'a missing mesh must not be silent').toBeTruthy()
    // Names the part AND the file, so the message points at the folder to look in.
    expect(problem).toContain('9V Battery')
    expect(problem).toContain('battery-9v.stl')
  })

  it('passes the underlying reason through when the copy gave one', () => {
    const plan = partBodyPlan(part({ mesh: 'm.stl' }), { error: 'Refusing symlinked part mesh' })
    expect((plan as { problem?: string }).problem).toContain('Refusing symlinked part mesh')
  })

  it('still names the part when it has no name to use', () => {
    const plan = partBodyPlan({ id: '', name: '', mesh: 'm.stl' }, null)
    expect((plan as { problem?: string }).problem).toBeTruthy()
  })
})

describe('mirroredOrigin — board layout carried into Build (#716)', () => {
  // RobotPart.x/y are canvas viewBox PIXELS at a dynamic px-per-mm — the review
  // caught the first cut treating them as millimetres (positions ~4-7.5× off).
  it('divides the px out FIRST, then re-centres by the part’s mm half-dims', () => {
    // 5 px/mm: x=100px → 20 mm, + 51/2 mm half-width → 45.5 mm → 0.046 m (rounded mm).
    const at = mirroredOrigin({ x: 100, y: 40 }, part(), 5)
    expect(at).not.toBeNull()
    expect(at![0]).toBeCloseTo(0.046)
    expect(at![2]).toBe(0)
  })

  it('negates canvas y (screen-down) so the scene is not mirror-imaged', () => {
    const at = mirroredOrigin({ x: 0, y: 40 }, part({ dimensions: undefined }), 4)
    expect(at![1]).toBeCloseTo(-0.01) // 40 px / 4 px-per-mm = 10 mm
  })

  it('is null for a click-add with no position (the stagger takes over)', () => {
    expect(mirroredOrigin({}, part(), 5)).toBeNull()
  })

  it('is null for a nonsense scale rather than dividing by zero', () => {
    expect(mirroredOrigin({ x: 10, y: 10 }, part(), 0)).toBeNull()
    expect(mirroredOrigin({ x: 10, y: 10 }, part(), NaN)).toBeNull()
  })
})

describe('canvasPxPerMm — the wiring canvas scale, shared (#716/#637)', () => {
  it('fits the widest/tallest body to the cap — the WiringCanvas formula', () => {
    // Widest 95 mm → 380/95 = 4 px/mm (the height constraint is looser here).
    expect(canvasPxPerMm([{ width: 95, height: 25 }, { width: 51, height: 21 }])).toBeCloseTo(4)
  })

  it('falls back to the default when nothing declares dimensions', () => {
    expect(canvasPxPerMm([undefined, {}])).toBeCloseTo(3.7)
  })
})

describe('movableJointNames — servo pickers skip placement joints (#716)', () => {
  it('excludes fixed joints (every placed part now carries one)', () => {
    const { urdf } = addBoxLink(blankUrdf('bot'), { linkBase: 'pico', size: [0.05, 0.02, 0.01] })
    const withServo =
      urdf.replace(
        '</robot>',
        '  <joint name="shoulder" type="revolute"><parent link="base_link"/><child link="pico"/></joint>\n</robot>'
      )
    expect(movableJointNames(withServo)).toEqual(['shoulder'])
    expect(jointNames(withServo)).toContain('pico_joint')
  })
})

describe('partInertial — the library mass source, live (#716/#535)', () => {
  it('converts grams → kilograms and part-frame mm → metres', () => {
    const spec = partInertial({ mass_g: 9, com_xyz: [10, -5, 3] })
    expect(spec).toEqual({ mass: 0.009, com: [0.01, -0.005, 0.003] })
  })

  it('defaults a box body’s CoM to the box centre, not the ground-plane origin', () => {
    expect(partInertial({ mass_g: 100 }, 0.02)!.com).toEqual([0, 0, 0.01])
    expect(partInertial({ mass_g: 100 })!.com).toEqual([0, 0, 0])
  })

  it('treats missing/zero mass as absent — never an invented 0 kg', () => {
    expect(partInertial({})).toBeNull()
    expect(partInertial({ mass_g: 0 })).toBeNull()
  })
})

describe('addBoxLink — the footprint-box URDF body (#716)', () => {
  it('appends a box link + fixed joint at the given origin', () => {
    const { urdf, link } = addBoxLink(blankUrdf('bot'), {
      linkBase: 'Pico 2 W',
      size: [0.051, 0.021, 0.012],
      rgb: [0.2, 0.4, 0.3],
      at: [0.1, -0.04, 0]
    })
    expect(link).toBe('Pico_2_W')
    expect(urdf).toContain('<box size="0.051 0.021 0.012"/>')
    expect(urdf).toContain('<origin xyz="0.1 -0.04 0" rpy="0 0 0"/>')
    // The visual is raised half the height so the link origin is the part's base.
    expect(urdf).toContain('<origin xyz="0 0 0.006" rpy="0 0 0"/>')
    expect(urdf).toContain('rgba="0.2 0.4 0.3 1"')
    expect(urdf).toContain(`<child link="${link}"/>`)
  })

  it('staggers along X when no origin is given (legacy behaviour)', () => {
    const { urdf } = addBoxLink(blankUrdf('bot'), { linkBase: 'p', size: [0.01, 0.01, 0.01] })
    expect(/<origin xyz="0\.08 0 0"/.test(urdf)).toBe(true)
  })

  it('composes with setInertial via readInertial round-trip', () => {
    const { urdf, link } = addBoxLink(blankUrdf('bot'), { linkBase: 'servo', size: [0.02, 0.02, 0.02] })
    const spec = partInertial({ mass_g: 9 }, 0.02)!
    const withMass = setInertial(urdf, link, spec)
    expect(readInertial(withMass, link)).toEqual({ mass: 0.009, com: [0, 0, 0.01] })
  })
})

describe('addMeshLink at-override (#716)', () => {
  it('places the mesh at the mirrored origin instead of the stagger', () => {
    const { urdf } = addMeshLink(blankUrdf('bot'), {
      meshRel: 'meshes/sg90.stl',
      linkBase: 'sg90',
      at: [0.05, -0.02, 0]
    })
    expect(urdf).toContain('<origin xyz="0.05 -0.02 0" rpy="0 0 0"/>')
  })
})

describe('planPartAdditions — the shared add plan (#716)', () => {
  const robot = { parts: [{ id: 'sg90', lib: 'std', part: 'sg90' }], connections: [] }

  it('assigns unique ids across the whole batch, reserving the board key', () => {
    const { placed } = planPartAdditions(
      robot,
      [
        { libraryId: 'std', part: part({ id: 'sg90', name: 'SG90' }) },
        { libraryId: 'std', part: part({ id: 'sg90', name: 'SG90' }) },
        { libraryId: 'std', part: part({ id: 'board', name: 'Board?' }) }
      ],
      false
    )
    expect(placed.map((p) => p.id)).toEqual(['sg902', 'sg903', 'board2'])
  })

  it('links robot.urdf only when Build bodies will actually be written', () => {
    const attach = planPartAdditions(robot, [{ libraryId: 'std', part: part() }], true)
    expect(attach.next.robot?.urdf).toBe('robot.urdf')
    const noAttach = planPartAdditions(robot, [{ libraryId: 'std', part: part() }], false)
    expect(noAttach.next.robot).toBeUndefined()
  })

  it('keeps an existing urdf link and rounds drop positions', () => {
    const withUrdf = { ...robot, robot: { version: 1, urdf: 'arm.urdf' } }
    const plan = planPartAdditions(
      withUrdf,
      [{ libraryId: 'std', part: part(), pos: { x: 10.6, y: 3.2 } }],
      true
    )
    expect(plan.urdfName).toBe('arm.urdf')
    expect(plan.placed[0].x).toBe(11)
    expect(plan.placed[0].y).toBe(3)
  })
})

describe('urdfLink round-trip (#716/#626 Part 1)', () => {
  it('survives robot.yml save → load', () => {
    const yaml = robotToYaml({
      parts: [{ id: 'sg90', lib: 'std', part: 'sg90', urdfLink: 'SG90' }],
      connections: []
    })
    expect(robotFromYaml(yaml).parts[0].urdfLink).toBe('SG90')
  })

  it('drops an empty urdfLink instead of persisting noise', () => {
    const yaml = robotToYaml({
      parts: [{ id: 'sg90', lib: 'std', part: 'sg90', urdfLink: '' }],
      connections: []
    })
    expect(robotFromYaml(yaml).parts[0].urdfLink).toBeUndefined()
  })
})
