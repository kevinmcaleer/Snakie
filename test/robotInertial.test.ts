import { describe, expect, it } from 'vitest'
import { DOMParser } from '@xmldom/xmldom'
import {
  blankUrdf,
  readInertial,
  removeInertial,
  setInertial
} from '../src/renderer/src/components/robot-assembly'
import { urdfHash } from '../src/shared/skeleton'

/**
 * #553 (epic #535 §1) — `<inertial>` round-trip through Snakie's regex URDF
 * layer, cross-checked against a standards XML DOM parser so the regex output
 * can't silently diverge from what `urdf-loader` (which parses via `DOMParser`)
 * will read at scene-load time.
 */

const TWO_LINK =
  `<?xml version="1.0"?>\n` +
  `<robot name="r">\n` +
  `  <link name="base">\n` +
  `    <visual>\n` +
  `      <geometry><box size="0.1 0.1 0.02"/></geometry>\n` +
  `    </visual>\n` +
  `  </link>\n` +
  `  <link name="arm">\n` +
  `    <visual>\n` +
  `      <geometry><cylinder radius="0.02" length="0.1"/></geometry>\n` +
  `    </visual>\n` +
  `  </link>\n` +
  `  <joint name="j" type="revolute">\n` +
  `    <parent link="base"/>\n` +
  `    <child link="arm"/>\n` +
  `    <axis xyz="0 0 1"/>\n` +
  `    <limit lower="-1" upper="1" effort="1" velocity="1"/>\n` +
  `  </joint>\n` +
  `</robot>\n`

/**
 * Read a link's inertial the way urdf-loader does — via a real XML DOM, walking
 * `<link>`→`<inertial>`→`<mass>`/`<origin>` by tag name. If this agrees with the
 * regex reader, the two parsers agree. Returns null when there is no such link
 * or no inertial, or when the XML is malformed (parse error).
 */
function loadInertial(urdf: string, link: string): { mass: number; xyz: number[] } | null {
  const doc = new DOMParser().parseFromString(urdf, 'text/xml')
  if (doc.getElementsByTagName('parsererror').length) return null
  const links = Array.from(doc.getElementsByTagName('link'))
  const el = links.find((l) => l.getAttribute('name') === link)
  if (!el) return null
  const inertial = Array.from(el.getElementsByTagName('inertial'))[0]
  if (!inertial) return null
  const mass = Array.from(inertial.getElementsByTagName('mass'))[0]
  if (!mass) return null
  const origin = Array.from(inertial.getElementsByTagName('origin'))[0]
  const xyz = (origin?.getAttribute('xyz') ?? '0 0 0').trim().split(/\s+/).map(Number)
  return { mass: Number(mass.getAttribute('value')), xyz }
}

describe('readInertial / setInertial round-trip', () => {
  it('returns null for a link with no <inertial>', () => {
    expect(readInertial(TWO_LINK, 'base')).toBeNull()
  })

  it('writes then reads back the same mass and CoM', () => {
    const u = setInertial(TWO_LINK, 'arm', { mass: 0.009, com: [0, 0, 0.05] })
    const got = readInertial(u, 'arm')
    expect(got).not.toBeNull()
    expect(got!.mass).toBeCloseTo(0.009, 6)
    expect(got!.com).toEqual([0, 0, 0.05])
  })

  it('scopes the write to the target link — the other link stays bare', () => {
    const u = setInertial(TWO_LINK, 'arm', { mass: 1, com: [0, 0, 0] })
    expect(readInertial(u, 'base')).toBeNull()
    expect(readInertial(u, 'arm')).not.toBeNull()
  })

  it('replaces an existing block instead of appending a second', () => {
    let u = setInertial(TWO_LINK, 'arm', { mass: 1, com: [0, 0, 0] })
    u = setInertial(u, 'arm', { mass: 2, com: [1, 2, 3] })
    expect((u.match(/<inertial>/g) ?? []).length).toBe(1)
    const got = readInertial(u, 'arm')
    expect(got!.mass).toBeCloseTo(2, 6)
    expect(got!.com).toEqual([1, 2, 3])
  })

  it('leaves the visual geometry untouched', () => {
    const u = setInertial(TWO_LINK, 'arm', { mass: 0.5, com: [0, 0, 0] })
    expect(u).toContain('<cylinder radius="0.02" length="0.1"/>')
    expect(u).toContain('<box size="0.1 0.1 0.02"/>')
  })

  it('produces well-formed XML a DOM parser still reads', () => {
    const u = setInertial(TWO_LINK, 'arm', { mass: 0.02, com: [0, 0, 0.05] })
    const robot = loadInertial(u, 'arm')
    expect(robot).not.toBeNull()
  })
})

describe('agreement with a DOM parser (the dual-parser hazard)', () => {
  it('the DOM parser reads back exactly what setInertial wrote', () => {
    const u = setInertial(TWO_LINK, 'arm', { mass: 0.0123, com: [0.01, -0.02, 0.03] })
    const viaLoader = loadInertial(u, 'arm')
    const viaRegex = readInertial(u, 'arm')
    expect(viaLoader!.mass).toBeCloseTo(viaRegex!.mass, 6)
    expect(viaLoader!.xyz[0]).toBeCloseTo(viaRegex!.com[0], 6)
    expect(viaLoader!.xyz[1]).toBeCloseTo(viaRegex!.com[1], 6)
    expect(viaLoader!.xyz[2]).toBeCloseTo(viaRegex!.com[2], 6)
  })

  it('the regex reader accepts a DOM-style block with attributes reordered', () => {
    // A DOM parser is attribute-order- and whitespace-agnostic; the regex reader
    // must be too, or it will fail to read a hand-authored or ROS-exported file.
    const hand = TWO_LINK.replace(
      '  <link name="arm">\n',
      '  <link name="arm">\n' +
        '    <inertial>\n' +
        '      <mass value="0.44"/>\n' +
        '      <origin rpy="0 0 0"  xyz="0.1  0.2 0.3" />\n' +
        '      <inertia ixx="0" iyy="0" izz="0" ixy="0" ixz="0" iyz="0"/>\n' +
        '    </inertial>\n'
    )
    const got = readInertial(hand, 'arm')
    expect(got!.mass).toBeCloseTo(0.44, 6)
    expect(got!.com).toEqual([0.1, 0.2, 0.3])
  })
})

describe('removeInertial', () => {
  it('removes the block and leaves no <inertial> behind', () => {
    const u = setInertial(TWO_LINK, 'arm', { mass: 1, com: [0, 0, 0] })
    const back = removeInertial(u, 'arm')
    expect(back).not.toContain('<inertial')
    expect(readInertial(back, 'arm')).toBeNull()
  })

  it('round-trips back to a URDF equal to the original (whitespace-insensitive)', () => {
    const u = setInertial(TWO_LINK, 'arm', { mass: 1, com: [0, 0, 0] })
    const back = removeInertial(u, 'arm')
    // urdfHash ignores whitespace, so set-then-remove restores the model even
    // if a stray blank line lingered — the property the staleness check cares about.
    expect(urdfHash(back)).toBe(urdfHash(TWO_LINK))
  })

  it('is a no-op on a link that never had inertial', () => {
    expect(removeInertial(TWO_LINK, 'base')).toBe(TWO_LINK)
  })
})

describe('does not disturb the blank starter robot', () => {
  it('adds inertial to base_link and reads it back', () => {
    const u = setInertial(blankUrdf('bot'), 'base_link', { mass: 0.05, com: [0, 0, 0.01] })
    const got = readInertial(u, 'base_link')
    expect(got!.mass).toBeCloseTo(0.05, 6)
  })
})
