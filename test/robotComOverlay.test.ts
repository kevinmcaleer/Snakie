import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import type { URDFRobot } from 'urdf-loader'
import { createComOverlay, type ComOverlayData } from '../src/renderer/src/components/robot-com-overlay'

/**
 * Integration test for the CoM overlay's three.js glue (#558) — exercised with
 * real data, which the unsaved demo in the browser harness can't provide. Uses
 * plain three.js Object3Ds as the robot's links.
 */

/** A minimal URDFRobot stand-in: named links at world positions. */
function fakeRobot(linkPos: Record<string, [number, number, number]>): URDFRobot {
  const rootGroup = new THREE.Group()
  const links: Record<string, THREE.Object3D> = {}
  for (const [name, p] of Object.entries(linkPos)) {
    const o = new THREE.Object3D()
    o.position.set(p[0], p[1], p[2])
    rootGroup.add(o)
    links[name] = o
  }
  rootGroup.updateMatrixWorld(true)
  return {
    links,
    updateMatrixWorld: (force?: boolean) => rootGroup.updateMatrixWorld(force)
  } as unknown as URDFRobot
}

/** Find the polygon fill mesh (the one with the most vertices) under a scene. */
function fillVertexCount(scene: THREE.Scene): number {
  let max = 0
  scene.traverse((o) => {
    const m = o as THREE.Mesh
    const pos = (m.geometry as THREE.BufferGeometry | undefined)?.getAttribute?.('position')
    if (pos && pos.count > max) max = pos.count
  })
  return max
}

describe('createComOverlay', () => {
  it('computes a stable verdict for a CoM inside the support polygon', () => {
    const scene = new THREE.Scene()
    // Two equal masses at x=0 and x=0.2 → CoM projects to (0.1, 0). Four feet in a
    // 0.2 × 0.2 square centred there → the projection sits dead centre, stable.
    const robot = fakeRobot({
      a: [0, 0.1, 0],
      b: [0.2, 0.1, 0],
      f1: [0, 0, -0.1],
      f2: [0.2, 0, -0.1],
      f3: [0.2, 0, 0.1],
      f4: [0, 0, 0.1]
    })
    const data: ComOverlayData = {
      masses: {
        a: { massKg: 1, comLocalM: [0, 0, 0] },
        b: { massKg: 1, comLocalM: [0, 0, 0] }
      },
      contacts: {
        f1: [[0, 0, 0]],
        f2: [[0, 0, 0]],
        f3: [[0, 0, 0]],
        f4: [[0, 0, 0]]
      },
      groundY: 0
    }
    const overlay = createComOverlay(scene, () => robot, () => data)
    overlay.setEnabled(true)
    const status = overlay.update()

    expect(status).not.toBeNull()
    expect(status!.state).toBe('stable')
    expect(status!.massKg).toBeCloseTo(2, 6)
    // The polygon fill got triangulated (a triangle → 3 vertices).
    expect(fillVertexCount(scene)).toBeGreaterThanOrEqual(3)
    overlay.dispose()
  })

  it('reports unstable when the CoM leaves the polygon', () => {
    const scene = new THREE.Scene()
    // Mass sits far out at x=1; the feet cluster near the origin → CoM outside.
    const robot = fakeRobot({
      heavy: [1, 0.1, 0],
      foot_l: [0, 0, 0],
      foot_r: [0.1, 0, 0],
      foot_b: [0.05, 0, 0.1]
    })
    const data: ComOverlayData = {
      masses: { heavy: { massKg: 1, comLocalM: [0, 0, 0] } },
      contacts: { foot_l: [[0, 0, 0]], foot_r: [[0, 0, 0]], foot_b: [[0, 0, 0]] },
      groundY: 0
    }
    const overlay = createComOverlay(scene, () => robot, () => data)
    overlay.setEnabled(true)
    const status = overlay.update()
    expect(status!.state).toBe('unstable')
    expect(status!.marginMm).toBeLessThan(0)
    overlay.dispose()
  })

  it('returns null and stays silent when nothing is weighed', () => {
    const scene = new THREE.Scene()
    const robot = fakeRobot({ a: [0, 0, 0] })
    const overlay = createComOverlay(scene, () => robot, () => ({
      masses: {},
      contacts: {},
      groundY: 0
    }))
    overlay.setEnabled(true)
    expect(overlay.update()).toBeNull()
    overlay.dispose()
  })

  it('reports "none" when weighed but with too few contacts to form a polygon', () => {
    const scene = new THREE.Scene()
    const robot = fakeRobot({ a: [0, 0.1, 0], foot: [0, 0, 0] })
    const overlay = createComOverlay(scene, () => robot, () => ({
      masses: { a: { massKg: 1, comLocalM: [0, 0, 0] } },
      contacts: { foot: [[0, 0, 0]] }, // one point — no polygon
      groundY: 0
    }))
    overlay.setEnabled(true)
    const status = overlay.update()
    expect(status!.state).toBe('none')
    overlay.dispose()
  })

  it('does nothing while disabled', () => {
    const scene = new THREE.Scene()
    const robot = fakeRobot({ a: [0, 0.1, 0] })
    const overlay = createComOverlay(scene, () => robot, () => ({
      masses: { a: { massKg: 1, comLocalM: [0, 0, 0] } },
      contacts: {},
      groundY: 0
    }))
    expect(overlay.update()).toBeNull() // never enabled
    overlay.dispose()
  })
})
