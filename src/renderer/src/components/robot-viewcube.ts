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
  // Bright brass faces (matching the lightest part of the panel/instrument
  // buttons) with a soft metallic sheen + a brass border.
  const g = ctx.createLinearGradient(0, 0, 0, 128)
  g.addColorStop(0, '#fbf1cf')
  g.addColorStop(0.5, '#f0d68a')
  g.addColorStop(1, '#e0bd5e')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 128, 128)
  ctx.strokeStyle = '#a9822f'
  ctx.lineWidth = 6
  ctx.strokeRect(3, 3, 122, 122)
  ctx.fillStyle = '#2b2205' // dark-brass ink, readable on brass
  ctx.font = 'bold 22px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, 64, 66)
  const tex = new THREE.CanvasTexture(c)
  tex.anisotropy = 4
  return tex
}

/** A coloured axis letter (X/Y/Z) on a transparent canvas for a billboard sprite. */
function axisLabelTexture(text: string, colorHex: number): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const ctx = c.getContext('2d')!
  ctx.fillStyle = `#${colorHex.toString(16).padStart(6, '0')}`
  ctx.font = 'bold 46px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, 32, 34)
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
  // A PERSPECTIVE nav camera so the cube always looks 3-D (independent of the main
  // viewer's ortho/perspective mode).
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 20)
  camera.position.set(0, 0, 4.6)
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

  // X/Y/Z orientation axes from the bottom-back-left corner along the three edges
  // meeting there (X red, Y green, Z blue), with a labelled tip. Children of the
  // cube so they track its orientation; occluded naturally (depthTest on).
  const AXES = [
    { end: new THREE.Vector3(1, 0, 0), color: 0xe0483a, label: 'X' },
    { end: new THREE.Vector3(0, 1, 0), color: 0x40b04a, label: 'Y' },
    { end: new THREE.Vector3(0, 0, 1), color: 0x4a78e0, label: 'Z' }
  ]
  const corner = new THREE.Vector3(-0.5, -0.5, -0.5)
  const AXIS_LEN = 1.32 // poke ~0.32 beyond the far edge so the colour shows
  const axisDisposables: Array<{ dispose: () => void }> = []
  for (const a of AXES) {
    const tip = corner.clone().add(a.end.clone().multiplyScalar(AXIS_LEN))
    const lg = new THREE.BufferGeometry().setFromPoints([corner, tip])
    const lm = new THREE.LineBasicMaterial({ color: a.color, linewidth: 2 })
    cube.add(new THREE.Line(lg, lm))
    axisDisposables.push(lg, lm)
    const lt = axisLabelTexture(a.label, a.color)
    // depthTest on → labels are occluded by the cube when behind it (they looked
    // odd showing through). transparent so the letter's alpha reads cleanly.
    const sm = new THREE.SpriteMaterial({ map: lt, transparent: true })
    const sprite = new THREE.Sprite(sm)
    sprite.position.copy(corner.clone().add(a.end.clone().multiplyScalar(AXIS_LEN + 0.2)))
    sprite.scale.set(0.34, 0.34, 1)
    cube.add(sprite)
    axisDisposables.push(lt, sm)
  }

  // A bright overlay that snaps to the hovered face / edge / corner — a thin plate
  // on a face, a bar along an edge, a small cube on a corner (from `raw`).
  const hlGeo = new THREE.BoxGeometry(1, 1, 1)
  const hlMat = new THREE.MeshBasicMaterial({ color: 0xfff0c0, transparent: true, opacity: 0.5, depthTest: false })
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

  // Drag-to-orbit vs click-to-snap: a near-stationary press is a click. Orbit by
  // the PER-MOVE delta (last→now), never `movementX` (unreliable under capture) or
  // the total-from-down (which re-applied the whole delta each frame → wild spin).
  let down: { x: number; y: number; lastX: number; lastY: number; moved: boolean } | null = null
  const onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0 || down) return // primary button only; ignore right/middle
    down = { x: e.clientX, y: e.clientY, lastX: e.clientX, lastY: e.clientY, moved: false }
    canvas.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: PointerEvent): void => {
    if (down) {
      if (down.moved || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 3) {
        down.moved = true
        onOrbit(e.clientX - down.lastX, e.clientY - down.lastY)
        setHighlight(null)
      }
      down.lastX = e.clientX
      down.lastY = e.clientY
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
  // If the OS/browser steals the gesture (touch cancel, capture loss) it fires
  // pointercancel, NOT pointerup — reset so a later bare hover doesn't keep orbiting.
  const onCancel = (e: PointerEvent): void => {
    canvas.releasePointerCapture?.(e.pointerId)
    down = null
    setHighlight(null)
  }
  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerup', onPointerUp)
  canvas.addEventListener('pointercancel', onCancel)
  canvas.addEventListener('lostpointercapture', onCancel)
  canvas.addEventListener('pointerleave', onLeave)
  canvas.style.cursor = 'pointer'

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
      canvas.removeEventListener('pointercancel', onCancel)
      canvas.removeEventListener('lostpointercapture', onCancel)
      canvas.removeEventListener('pointerleave', onLeave)
      geometry.dispose()
      edgeGeo.dispose()
      edgeMat.dispose()
      axisDisposables.forEach((d) => d.dispose())
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
