/**
 * NAVIGATION CUBE (#309) — a CAD-style ViewCube in the corner of the 3-D viewer.
 *
 * It mirrors the main camera's orientation each frame. You can:
 *  - CLICK a face / edge / corner (26 regions) to snap to that orthographic view,
 *  - DRAG the cube to orbit the camera,
 *  - and the region under the pointer highlights in brass.
 *
 * It runs in its OWN tiny canvas + WebGL context so its pointer handling can't
 * fight the main viewer's OrbitControls. The scene is three's Y-up (the URDF
 * loader rotates Z-up models into Y-up), so +Y = top, +Z = front. Faces are lit
 * from the lower-front so the block reads as solid.
 */
import * as THREE from 'three'

export interface ViewCube {
  /** The cube's canvas — append it where you want the widget (top-right). */
  readonly dom: HTMLCanvasElement
  /** Orient the cube to match the main camera (call each frame before render). */
  sync: (cameraQuaternion: THREE.Quaternion) => void
  render: () => void
  dispose: () => void
}

// BoxGeometry material order: +X, -X, +Y, -Y, +Z, -Z.
const FACE_LABELS = ['RIGHT', 'LEFT', 'TOP', 'BOT', 'FRONT', 'BACK']

/** A face label painted onto a canvas texture (parchment, dark-brass border). */
function faceTexture(text: string): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#e7e2d3'
  ctx.fillRect(0, 0, 128, 128)
  ctx.strokeStyle = '#8a6a2a'
  ctx.lineWidth = 6
  ctx.strokeRect(3, 3, 122, 122)
  ctx.fillStyle = '#34373d'
  ctx.font = 'bold 22px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, 64, 66)
  const tex = new THREE.CanvasTexture(c)
  tex.anisotropy = 4
  return tex
}

/** Classify a local hit point on the unit cube into `raw` (±1/0 per axis — which
 *  face/edge/corner) and `dir` (the normalised view direction to snap to). */
function classify(p: THREE.Vector3): { dir: THREE.Vector3; raw: THREE.Vector3 } {
  const thr = 0.32 // within 0.18 of an edge counts as that edge/corner
  const raw = new THREE.Vector3()
  ;[p.x, p.y, p.z].forEach((v, ax) => {
    if (Math.abs(v) >= thr) raw.setComponent(ax, v >= 0 ? 1 : -1)
  })
  if (raw.lengthSq() === 0) raw.set(0, 0, 1) // safety (shouldn't happen on a surface hit)
  return { dir: raw.clone().normalize(), raw }
}

export function createViewCube(opts: {
  size: number
  onPick: (dir: THREE.Vector3) => void
  onOrbit: (dxPx: number, dyPx: number) => void
}): ViewCube {
  const { size, onPick, onOrbit } = opts
  const canvas = document.createElement('canvas')
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.setSize(size, size)

  const scene = new THREE.Scene()
  const camera = new THREE.OrthographicCamera(-1.5, 1.5, 1.5, -1.5, 0.1, 10)
  camera.position.set(0, 0, 4)
  camera.lookAt(0, 0, 0)
  // Lit from the lower-front so the cube looks like a solid, shaded block.
  scene.add(new THREE.HemisphereLight(0xffffff, 0x6b6b6b, 0.9))
  const keyLight = new THREE.DirectionalLight(0xffffff, 0.75)
  keyLight.position.set(-0.4, -0.9, 1.4) // lower-front
  scene.add(keyLight)

  const materials = FACE_LABELS.map((label) => new THREE.MeshLambertMaterial({ map: faceTexture(label) }))
  const geometry = new THREE.BoxGeometry(1, 1, 1)
  const cube = new THREE.Mesh(geometry, materials)
  scene.add(cube)
  const edgeGeo = new THREE.EdgesGeometry(geometry)
  const edgeMat = new THREE.LineBasicMaterial({ color: 0x6b5220 })
  const edges = new THREE.LineSegments(edgeGeo, edgeMat)
  cube.add(edges)

  // A brass overlay that snaps to the hovered face / edge / corner — a thin plate
  // on a face, a bar along an edge, a small cube on a corner (from `raw`).
  const hlGeo = new THREE.BoxGeometry(1, 1, 1)
  const hlMat = new THREE.MeshBasicMaterial({ color: 0xc8a24a, transparent: true, opacity: 0.55, depthTest: false })
  const highlight = new THREE.Mesh(hlGeo, hlMat)
  highlight.visible = false
  highlight.renderOrder = 3
  cube.add(highlight)
  const setHighlight = (raw: THREE.Vector3 | null): void => {
    if (!raw) {
      highlight.visible = false
      return
    }
    highlight.visible = true
    highlight.position.set(raw.x * 0.5, raw.y * 0.5, raw.z * 0.5)
    const t = 0.12 // thin on the "extreme" axes, spanning on the free ones
    highlight.scale.set(raw.x !== 0 ? t : 0.98, raw.y !== 0 ? t : 0.98, raw.z !== 0 ? t : 0.98)
  }

  const raycaster = new THREE.Raycaster()
  const ndc = new THREE.Vector2()
  const pick = (e: PointerEvent): { dir: THREE.Vector3; raw: THREE.Vector3 } | null => {
    const rect = canvas.getBoundingClientRect()
    ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
    ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
    raycaster.setFromCamera(ndc, camera)
    // Don't let the highlight overlay intercept the pick.
    const hit = raycaster.intersectObject(cube, false).find((h) => h.object === cube)
    return hit ? classify(cube.worldToLocal(hit.point.clone())) : null
  }

  // Drag-to-orbit vs click-to-snap: a near-stationary press is a click.
  let down: { x: number; y: number; moved: boolean } | null = null
  const onPointerDown = (e: PointerEvent): void => {
    down = { x: e.clientX, y: e.clientY, moved: false }
    canvas.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: PointerEvent): void => {
    if (down) {
      const dx = e.clientX - down.x
      const dy = e.clientY - down.y
      if (down.moved || Math.hypot(dx, dy) > 3) {
        down.moved = true
        onOrbit(e.movementX || dx, e.movementY || dy)
        setHighlight(null)
      }
      return
    }
    const r = pick(e)
    setHighlight(r ? r.raw : null)
  }
  const onPointerUp = (e: PointerEvent): void => {
    canvas.releasePointerCapture?.(e.pointerId)
    const wasClick = down && !down.moved
    down = null
    if (wasClick) {
      const r = pick(e)
      if (r) onPick(r.dir)
    }
  }
  const onLeave = (): void => {
    if (!down) setHighlight(null)
  }
  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerup', onPointerUp)
  canvas.addEventListener('pointerleave', onLeave)
  canvas.style.cursor = 'grab'

  const inv = new THREE.Quaternion()
  return {
    dom: canvas,
    sync: (q) => {
      inv.copy(q).invert()
      cube.quaternion.copy(inv)
    },
    render: () => renderer.render(scene, camera),
    dispose: () => {
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointerleave', onLeave)
      geometry.dispose()
      edgeGeo.dispose()
      edgeMat.dispose()
      hlGeo.dispose()
      hlMat.dispose()
      materials.forEach((m) => {
        m.map?.dispose()
        m.dispose()
      })
      renderer.dispose()
    }
  }
}
