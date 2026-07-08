/**
 * NAVIGATION CUBE (#309) — a small CAD-style ViewCube floating in the corner of
 * the 3-D viewer. It mirrors the main camera's orientation each frame, and
 * clicking a face snaps the camera to that orthographic view (front/back/…/top).
 *
 * It runs in its OWN tiny canvas + WebGL context so its pointer handling can't
 * fight the main viewer's OrbitControls. The host calls `sync()` + `render()`
 * each frame and handles `onPick(dir)` by moving the main camera to look at the
 * model FROM `dir` (a world-space unit direction). The scene is three's Y-up
 * (the URDF loader rotates Z-up models into Y-up), so +Y = top, +Z = front.
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

const FACES: Array<{ label: string; normal: [number, number, number] }> = [
  { label: 'RIGHT', normal: [1, 0, 0] }, // +X  (BoxGeometry material order)
  { label: 'LEFT', normal: [-1, 0, 0] }, // -X
  { label: 'TOP', normal: [0, 1, 0] }, // +Y
  { label: 'BOT', normal: [0, -1, 0] }, // -Y
  { label: 'FRONT', normal: [0, 0, 1] }, // +Z
  { label: 'BACK', normal: [0, 0, -1] } // -Z
]

/** A face label painted onto a canvas texture (parchment-brass, readable). */
function faceTexture(text: string): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#e7e2d3'
  ctx.fillRect(0, 0, 128, 128)
  ctx.strokeStyle = '#b07d1e'
  ctx.lineWidth = 7
  ctx.strokeRect(4, 4, 120, 120)
  ctx.fillStyle = '#34373d'
  ctx.font = 'bold 24px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, 64, 66)
  const tex = new THREE.CanvasTexture(c)
  tex.anisotropy = 4
  return tex
}

export function createViewCube(opts: {
  size: number
  onPick: (dir: THREE.Vector3) => void
}): ViewCube {
  const { size, onPick } = opts
  const canvas = document.createElement('canvas')
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.setSize(size, size)

  const scene = new THREE.Scene()
  // Fixed ortho camera looking straight at the cube; the CUBE rotates.
  const camera = new THREE.OrthographicCamera(-1.5, 1.5, 1.5, -1.5, 0.1, 10)
  camera.position.set(0, 0, 4)
  camera.lookAt(0, 0, 0)
  scene.add(new THREE.HemisphereLight(0xffffff, 0x555555, 1.2))

  const materials = FACES.map((f) => {
    const map = faceTexture(f.label)
    return new THREE.MeshBasicMaterial({ map })
  })
  const geometry = new THREE.BoxGeometry(1, 1, 1)
  const cube = new THREE.Mesh(geometry, materials)
  scene.add(cube)
  // Crisp edges so the cube reads as a solid block.
  const edgeGeo = new THREE.EdgesGeometry(geometry)
  const edgeMat = new THREE.LineBasicMaterial({ color: 0x8a6a2a })
  const edges = new THREE.LineSegments(edgeGeo, edgeMat)
  cube.add(edges)

  const raycaster = new THREE.Raycaster()
  const ndc = new THREE.Vector2()

  const onClick = (e: MouseEvent): void => {
    const rect = canvas.getBoundingClientRect()
    ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
    ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
    raycaster.setFromCamera(ndc, camera)
    const hit = raycaster.intersectObject(cube, false)[0]
    if (!hit || !hit.face) return
    // The clicked face's LOCAL normal is the world axis it represents (the cube's
    // local axes map 1:1 to world axes; the rotation only faces it at the viewer).
    const n = hit.face.normal
    onPick(new THREE.Vector3(Math.round(n.x), Math.round(n.y), Math.round(n.z)))
  }
  canvas.addEventListener('click', onClick)
  canvas.style.cursor = 'pointer'

  const inv = new THREE.Quaternion()
  return {
    dom: canvas,
    sync: (q) => {
      // Cube orientation = inverse of the camera's world orientation, so the face
      // toward the viewer is the world direction the camera looks along.
      inv.copy(q).invert()
      cube.quaternion.copy(inv)
    },
    render: () => renderer.render(scene, camera),
    dispose: () => {
      canvas.removeEventListener('click', onClick)
      geometry.dispose()
      edgeGeo.dispose()
      edgeMat.dispose()
      materials.forEach((m) => {
        m.map?.dispose()
        m.dispose()
      })
      renderer.dispose()
    }
  }
}
