/**
 * CoM + SUPPORT-POLYGON OVERLAY (#558, epic #535 §2) — the headline of §2, no
 * physics. A toggleable Robot View overlay showing where the robot balances and
 * whether it stays up.
 *
 *  • a marker at the live mass-weighted centre of mass (#556),
 *  • a plumb line down to the ground + a ground marker,
 *  • the SUPPORT POLYGON: the convex hull of the grounded contact points (#557),
 *  • coloured by static stability — green inside, amber near the edge, red once
 *    the CoM projection leaves the polygon and the robot would tip.
 *
 * Everything recomputes each frame from the live scene, so it tracks sliders,
 * Motion Studio playback, IK drags and board telemetry alike. Follows the same
 * factory lifecycle as Bone Mode (`create*`/`setEnabled`/`update`/`dispose`) and
 * composes with it. The maths is all in the pure `robot-com` / `robot-contacts`
 * / `robot-support` modules; this file is only the three.js glue.
 */
import * as THREE from 'three'
import type { URDFRobot } from 'urdf-loader'
import { robotWorldCoM, type LinkMass } from './robot-com'
import { contactWorldPoints } from './robot-contacts'
import { comStability, supportPolygon, type Pt2, type StabilityState } from './robot-support'

/** What the overlay needs each frame — supplied by RobotView. */
export interface ComOverlayData {
  /** Per-link mass + local CoM (`readLinkMasses(content)`), static per edit. */
  masses: Record<string, LinkMass>
  /** Per-link ground-contact points, link-local metres (robot.yml `contacts`). */
  contacts: Record<string, [number, number, number][]>
  /** The ground-plane height in the scene (the grid's Y). */
  groundY: number
  /** Amber-band width as a fraction of polygon size (default 0.1). */
  marginFrac?: number
}

/** The live stability readout, for a HUD pill. Null when nothing's computed. */
export interface ComStatus {
  state: StabilityState
  marginMm: number
  massKg: number
}

export interface ComOverlayHandle {
  setEnabled(on: boolean): void
  /** Per-frame: recompute + redraw; returns the current status (or null). */
  update(): ComStatus | null
  dispose(): void
}

const STATE_COLOR: Record<StabilityState, number> = {
  stable: 0x4caf50,
  marginal: 0xffb300,
  unstable: 0xe53935,
  none: 0x8b919b
}

export function createComOverlay(
  scene: THREE.Scene,
  getRobot: () => URDFRobot | null,
  getData: () => ComOverlayData
): ComOverlayHandle {
  const root = new THREE.Group()
  root.visible = false
  root.renderOrder = 3
  scene.add(root)

  // CoM marker — a small bright sphere, drawn on top (depthTest off) so it's
  // never hidden inside the mesh.
  const comMat = new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false })
  const comMarker = new THREE.Mesh(new THREE.SphereGeometry(0.006, 16, 12), comMat)
  comMarker.renderOrder = 5
  root.add(comMarker)

  // Plumb line CoM → ground + a ground marker ring.
  const lineMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, depthTest: false })
  const lineGeom = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()])
  const plumb = new THREE.Line(lineGeom, lineMat)
  plumb.renderOrder = 4
  root.add(plumb)

  const groundMat = new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, side: THREE.DoubleSide })
  const groundMarker = new THREE.Mesh(new THREE.RingGeometry(0.004, 0.008, 20), groundMat)
  groundMarker.rotation.x = -Math.PI / 2
  groundMarker.renderOrder = 4
  root.add(groundMarker)

  // Support polygon — a translucent fill + a crisp outline, both rebuilt per
  // frame (the hull changes as feet lift). Colour tracks stability.
  const fillMat = new THREE.MeshBasicMaterial({
    color: STATE_COLOR.none,
    transparent: true,
    opacity: 0.18,
    side: THREE.DoubleSide,
    depthWrite: false
  })
  const fill = new THREE.Mesh(new THREE.BufferGeometry(), fillMat)
  fill.renderOrder = 2
  root.add(fill)

  const edgeMat = new THREE.LineBasicMaterial({ color: STATE_COLOR.none, transparent: true, opacity: 0.9 })
  const edge = new THREE.LineLoop(new THREE.BufferGeometry(), edgeMat)
  edge.renderOrder = 3
  root.add(edge)

  let enabled = false

  /** Rebuild the polygon fill (fan-triangulated) + outline from a hull. */
  const drawPolygon = (hull: Pt2[], groundY: number, color: number): void => {
    fillMat.color.setHex(color)
    edgeMat.color.setHex(color)
    if (hull.length < 3) {
      fill.visible = false
      edge.visible = false
      return
    }
    fill.visible = true
    edge.visible = true

    // Outline: the hull vertices on the ground plane.
    const loop: number[] = []
    for (const [x, z] of hull) loop.push(x, groundY + 0.0005, z)
    const eg = edge.geometry
    eg.setAttribute('position', new THREE.Float32BufferAttribute(loop, 3))
    eg.computeBoundingSphere()

    // Fill: fan from vertex 0 (valid for a convex polygon).
    const verts: number[] = []
    for (let i = 1; i < hull.length - 1; i++) {
      verts.push(hull[0][0], groundY, hull[0][1])
      verts.push(hull[i][0], groundY, hull[i][1])
      verts.push(hull[i + 1][0], groundY, hull[i + 1][1])
    }
    const fg = fill.geometry
    fg.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
    fg.computeBoundingSphere()
  }

  const update = (): ComStatus | null => {
    if (!enabled) return null
    const robot = getRobot()
    if (!robot) {
      root.visible = false
      return null
    }
    root.visible = true
    robot.updateMatrixWorld(true)
    const matOf = (l: string): THREE.Matrix4 | null => robot.links[l]?.matrixWorld ?? null

    const data = getData()
    const com = robotWorldCoM(matOf, data.masses)
    if (!com) {
      // Nothing weighed — hide everything, report nothing.
      comMarker.visible = false
      plumb.visible = false
      groundMarker.visible = false
      drawPolygon([], data.groundY, STATE_COLOR.none)
      return null
    }
    comMarker.visible = true
    plumb.visible = true
    groundMarker.visible = true

    const [cx, cy, cz] = com.comWorld
    comMarker.position.set(cx, cy, cz)
    groundMarker.position.set(cx, data.groundY + 0.0005, cz)
    lineGeom.setFromPoints([new THREE.Vector3(cx, cy, cz), new THREE.Vector3(cx, data.groundY, cz)])
    lineGeom.computeBoundingSphere()

    const worldContacts = contactWorldPoints(matOf, data.contacts).map((c) => c.world)
    const hull = supportPolygon(worldContacts)
    const stability = comStability([cx, cz], hull, data.marginFrac)
    drawPolygon(hull, data.groundY, STATE_COLOR[stability.state])

    return { state: stability.state, marginMm: stability.marginMm, massKg: com.massKg }
  }

  return {
    setEnabled(on: boolean): void {
      enabled = on
      root.visible = on
      if (!on) return
      update()
    },
    update,
    dispose(): void {
      scene.remove(root)
      comMarker.geometry.dispose()
      comMat.dispose()
      lineGeom.dispose()
      lineMat.dispose()
      groundMarker.geometry.dispose()
      groundMat.dispose()
      fill.geometry.dispose()
      fillMat.dispose()
      edge.geometry.dispose()
      edgeMat.dispose()
    }
  }
}
