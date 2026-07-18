import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  generateSkeleton,
  readSkeletonHash,
  SKELETON_SCHEMA_VERSION,
  skeletonJson,
  skeletonPathFor,
  skeletonStale,
  urdfHash,
  type SkeletonDoc
} from '../src/shared/skeleton'
import { prettyUrdf } from '../src/shared/urdf-export'
import type { ServoJointBinding } from '../src/shared/robot'

/** A small hand-rolled URDF exercising every joint feature the schema carries. */
const SAMPLE = `<?xml version="1.0"?>
<robot name="test_bot">
  <link name="base"/>
  <joint name="shoulder" type="revolute">
    <parent link="base"/>
    <child link="upper"/>
    <origin xyz="0 0 0.05" rpy="0 0 1.5708"/>
    <axis xyz="0 0 1"/>
    <limit lower="-1.5708" upper="1.5708" effort="1" velocity="1"/>
  </joint>
  <link name="upper"/>
  <joint name="slide" type="prismatic">
    <parent link="upper"/>
    <child link="slider"/>
    <origin xyz="0.03 0.04 0"/>
    <axis xyz="1 0 0"/>
    <limit lower="0" upper="0.05" effort="1" velocity="1"/>
  </joint>
  <link name="slider"/>
  <joint name="mount" type="fixed">
    <parent link="slider"/>
    <child link="tool"/>
    <origin xyz="0 0 0.01"/>
  </joint>
  <link name="tool"/>
  <joint name="mirror" type="revolute">
    <parent link="base"/>
    <child link="wing"/>
    <origin xyz="0 0.02 0"/>
    <axis xyz="0 1 0"/>
    <limit lower="-1" upper="1" effort="1" velocity="1"/>
    <mimic joint="shoulder" multiplier="-1" offset="0.5"/>
  </joint>
  <link name="wing"/>
</robot>
`

const BINDINGS: ServoJointBinding[] = [
  { pin: 'GP16', joint: 'shoulder', servoMin: 0, servoMax: 180, jointMin: -90, jointMax: 90 },
  { pin: '7', joint: 'slide', jointMin: 0, jointMax: 50, invert: true }
]

/** skeleton.json generation (#537, epic #533 §2). */
describe('skeleton', () => {
  it('generates one entry per joint with type, parent/child, axis and limits', () => {
    const doc = generateSkeleton(SAMPLE)
    expect(doc.schema_version).toBe(SKELETON_SCHEMA_VERSION)
    expect(doc.robot).toBe('test_bot')
    expect(doc.joints.map((j) => j.name)).toEqual(['shoulder', 'slide', 'mount', 'mirror'])

    const shoulder = doc.joints[0]
    expect(shoulder.type).toBe('revolute')
    expect(shoulder.parent).toBe('base')
    expect(shoulder.child).toBe('upper')
    expect(shoulder.axis).toEqual([0, 0, 1])
    expect(shoulder.origin_xyz).toEqual([0, 0, 0.05])
    expect(shoulder.origin_rpy).toEqual([0, 0, 1.5708])
    // rad → deg, rounded to 2 dp (1.5708 rad → 90, not 89.9954).
    expect(shoulder.limits).toEqual({ min: -90, max: 90 })

    const slide = doc.joints[1]
    expect(slide.type).toBe('prismatic')
    // m → mm travel for a sliding joint.
    expect(slide.limits).toEqual({ min: 0, max: 50 })

    const mount = doc.joints[2]
    expect(mount.type).toBe('fixed')
    expect(mount.axis).toBeUndefined()
    expect(mount.limits).toBeUndefined()

    expect(doc.joints[3].mimic).toEqual({ joint: 'shoulder', multiplier: -1, offset: 0.5 })
  })

  it('computes bone length as the distance between joint origins, in mm', () => {
    const doc = generateSkeleton(SAMPLE)
    expect(doc.joints[0].bone_length_mm).toBe(50) // |(0,0,0.05)| m
    expect(doc.joints[1].bone_length_mm).toBe(50) // 3-4-5 triangle: |(0.03,0.04,0)|
    expect(doc.joints[2].bone_length_mm).toBe(10)
  })

  it('attaches servo bindings (normalised pin + calibration) where mapped', () => {
    const doc = generateSkeleton(SAMPLE, BINDINGS)
    expect(doc.joints[0].servo).toEqual({
      pin: '16', // GP16 normalised
      servo_min: 0,
      servo_max: 180,
      joint_min: -90,
      joint_max: 90
    })
    expect(doc.joints[1].servo).toEqual({
      pin: '7',
      servo_min: 0, // defaulted
      servo_max: 180,
      joint_min: 0,
      joint_max: 50,
      invert: true
    })
    expect(doc.joints[2].servo).toBeUndefined()
  })

  it('carries a per-link section covering every link (extensible for #535)', () => {
    const doc = generateSkeleton(SAMPLE)
    expect(Object.keys(doc.links)).toEqual(['base', 'upper', 'slider', 'tool', 'wing'])
    for (const link of Object.values(doc.links)) expect(link).toEqual({})
  })

  it('round-trips through JSON unchanged (what MicroPython json.load sees)', () => {
    const doc = generateSkeleton(SAMPLE, BINDINGS)
    const parsed = JSON.parse(skeletonJson(doc)) as SkeletonDoc
    expect(parsed).toEqual(doc)
    expect(parsed.urdf_hash).toBe(urdfHash(SAMPLE))
  })

  it('generates the bundled demo-arm URDF: 3 revolute joints, all bones sized', () => {
    const src = readFileSync(resolve(__dirname, '../src/renderer/src/assets/demo-arm.urdf'), 'utf8')
    const doc = generateSkeleton(src)
    expect(doc.robot).toBe('demo_arm')
    expect(doc.joints.map((j) => j.name)).toEqual(['shoulder', 'elbow', 'wrist'])
    for (const j of doc.joints) {
      expect(j.type).toBe('revolute')
      expect(j.bone_length_mm).toBeGreaterThan(0)
      expect(j.limits).toBeDefined()
    }
    expect(doc.joints[1].bone_length_mm).toBe(310) // elbow: <origin xyz="0 0 0.31">
  })

  it('is deterministic and drops duplicate joint names (first wins)', () => {
    const dup =
      '<robot name="d"><joint name="j" type="revolute"><parent link="a"/><child link="b"/>' +
      '<origin xyz="0 0 0.1"/></joint><joint name="j" type="fixed"><parent link="b"/>' +
      '<child link="c"/></joint></robot>'
    const doc = generateSkeleton(dup)
    expect(doc.joints).toHaveLength(1)
    expect(doc.joints[0].type).toBe('revolute')
    expect(generateSkeleton(dup)).toEqual(doc)
  })

  it('defaults a missing <origin> to zeros and skips a joint with no child', () => {
    const min =
      '<robot name="m"><joint name="j" type="fixed"><parent link="a"/><child link="b"/></joint>' +
      '<joint name="broken" type="fixed"><parent link="b"/></joint></robot>'
    const doc = generateSkeleton(min)
    expect(doc.joints).toHaveLength(1)
    expect(doc.joints[0].origin_xyz).toEqual([0, 0, 0])
    expect(doc.joints[0].bone_length_mm).toBe(0)
    // Links referenced only by joints (no <link> tags at all here) still appear.
    expect(Object.keys(doc.links).sort()).toEqual(['a', 'b'])
  })

  it('urdfHash ignores inter-tag whitespace (the clean export re-formats)', () => {
    expect(urdfHash(SAMPLE)).toBe(urdfHash(prettyUrdf(SAMPLE)))
    expect(urdfHash(SAMPLE)).toMatch(/^fnv1a-[0-9a-f]{8}$/)
    // …but a REAL edit changes it.
    expect(urdfHash(SAMPLE.replace('0.05', '0.06'))).not.toBe(urdfHash(SAMPLE))
  })

  it('skeletonStale compares the embedded hash against the current URDF', () => {
    const json = skeletonJson(generateSkeleton(SAMPLE))
    expect(skeletonStale(json, SAMPLE)).toBe(false)
    expect(skeletonStale(json, prettyUrdf(SAMPLE))).toBe(false) // formatting-only
    expect(skeletonStale(json, SAMPLE.replace('0.05', '0.06'))).toBe(true)
    expect(skeletonStale(null, SAMPLE)).toBe(true) // nothing on the board
    expect(skeletonStale('not json', SAMPLE)).toBe(true)
    expect(readSkeletonHash('{"urdf_hash": 42}')).toBeNull()
  })

  it('skeletonPathFor lands beside robot.yml at the project root', () => {
    expect(skeletonPathFor('/proj/urdf/arm.urdf')).toBe('/proj/skeleton.json')
    expect(skeletonPathFor('/proj/arm.urdf')).toBe('/proj/skeleton.json')
    expect(skeletonPathFor('urdf/arm.urdf')).toBe('skeleton.json')
    expect(skeletonPathFor('arm.urdf')).toBe('skeleton.json')
    expect(skeletonPathFor('C:\\proj\\urdf\\arm.urdf')).toBe('C:/proj/skeleton.json')
    // A folder merely ENDING in "urdf" is not the KRF urdf/ folder.
    expect(skeletonPathFor('/proj/myurdf/arm.urdf')).toBe('/proj/myurdf/skeleton.json')
  })
})
