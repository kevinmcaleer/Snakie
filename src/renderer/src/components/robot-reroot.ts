/**
 * RE-ROOTING a URDF (#309 builder) — "bless" another link as the base.
 *
 * A URDF is a tree that hangs off its ROOT link; every other link is reached by
 * a chain of `<joint>`s. To make some other link the root we reverse every joint
 * on the path from the old root down to the new one: swap its parent/child and
 * invert its origin transform. Links NOT on that path keep their parent, so their
 * sub-trees hang unchanged. This lets the user delete the old base (once another
 * block is the base) without stranding the rest of the model.
 *
 * The origin inversion uses three.js with the SAME Euler order urdf-loader applies
 * (`'ZYX'`), so a re-rooted model renders identically. For the builder's own
 * joints (origin `rpy = 0`) this is just negating the translation. Movable joints
 * that happen to sit on the reversed path keep their axis/limits as-is (best
 * effort — correct for the common all-fixed structural path).
 */
import * as THREE from 'three'
import { readAllJoints, rootLink, type JointFull } from './robot-assembly'
import type { Vec3 } from './robot-build'

const fmtNum = (n: number): string => (Math.round(n * 1e4) / 1e4).toString()
const fmtVec = (v: readonly number[]): string => v.map(fmtNum).join(' ')
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Invert an origin transform (child←parent becomes parent←child). */
function invertOrigin(xyz: Vec3, rpy: Vec3): { xyz: Vec3; rpy: Vec3 } {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(xyz[0], xyz[1], xyz[2]),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rpy[0], rpy[1], rpy[2], 'ZYX')),
    new THREE.Vector3(1, 1, 1)
  )
  m.invert()
  const p = new THREE.Vector3()
  const q = new THREE.Quaternion()
  const s = new THREE.Vector3()
  m.decompose(p, q, s)
  const e = new THREE.Euler().setFromQuaternion(q, 'ZYX')
  // Snap tiny float dust to zero so an rpy=0 joint stays clean text.
  const z = (n: number): number => (Math.abs(n) < 1e-9 ? 0 : n)
  return { xyz: [z(p.x), z(p.y), z(p.z)], rpy: [z(e.x), z(e.y), z(e.z)] }
}

/** Regenerate a joint block from a (possibly reversed) definition. */
function emitJoint(j: JointFull): string {
  let inner =
    `    <parent link="${j.parent}"/>\n` +
    `    <child link="${j.child}"/>\n` +
    `    <origin xyz="${fmtVec(j.xyz)}" rpy="${fmtVec(j.rpy)}"/>\n`
  if (j.axis) inner += `    <axis xyz="${fmtVec(j.axis)}"/>\n`
  if (j.limit) inner += `    <limit lower="${fmtNum(j.limit.lower)}" upper="${fmtNum(j.limit.upper)}" effort="1" velocity="1"/>\n`
  else if (j.type === 'continuous') inner += `    <limit effort="1" velocity="1"/>\n`
  if (j.mimic)
    inner += `    <mimic joint="${j.mimic.joint}" multiplier="${fmtNum(j.mimic.multiplier)}" offset="${fmtNum(j.mimic.offset)}"/>\n`
  return `  <joint name="${j.name}" type="${j.type}">\n${inner}  </joint>`
}

/** Replace the `<joint name="name">…</joint>` block in the text. */
function replaceJointByName(urdf: string, name: string, block: string): string {
  const re = new RegExp(`<joint\\b[^>]*\\bname\\s*=\\s*"${escapeRe(name)}"[^>]*>[\\s\\S]*?</joint>`, 'i')
  return urdf.replace(re, block)
}

/** The chain of joints from `newRoot` up to the current root, or null if there
 *  is no such path (not in the tree / a cycle / already the root). */
function pathToRoot(urdf: string, newRoot: string): JointFull[] | null {
  const root = rootLink(urdf)
  if (!root || newRoot === root) return null
  const byChild = new Map(readAllJoints(urdf).map((j) => [j.child, j]))
  const path: JointFull[] = []
  const seen = new Set<string>()
  let cur = newRoot
  while (cur !== root) {
    const j = byChild.get(cur)
    if (!j || seen.has(cur)) return null // detached or a cycle
    seen.add(cur)
    path.push(j)
    cur = j.parent
  }
  return path
}

/** True when `link` exists, isn't already the root, and reaches the root. */
export function canReRoot(urdf: string, link: string): boolean {
  return pathToRoot(urdf, link) !== null
}

/**
 * Re-root the model at `newRoot` (make it the base). Returns the URDF unchanged
 * if `newRoot` is already the root or can't be reached from it.
 */
export function reRoot(urdf: string, newRoot: string): string {
  const path = pathToRoot(urdf, newRoot)
  if (!path) return urdf
  let out = urdf
  for (const j of path) {
    const inv = invertOrigin(j.xyz, j.rpy)
    const reversed: JointFull = { ...j, parent: j.child, child: j.parent, xyz: inv.xyz, rpy: inv.rpy }
    out = replaceJointByName(out, j.name, emitJoint(reversed))
  }
  return out
}
