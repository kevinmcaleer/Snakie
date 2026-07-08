import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import URDFLoader from 'urdf-loader'
import type { URDFRobot } from 'urdf-loader'
import { useWorkspace } from '../store/workspace'
import './RobotView.css'

/**
 * ROBOT VIEW (#311, epic #309) — Phase 1: a 3D panel that renders a URDF robot.
 * =============================================================================
 *
 * Opening a `.urdf` file shows the model in a three.js scene with orbit / pan /
 * zoom. The URDF is parsed from the OPEN FILE's content (so it lives in the
 * workspace, no server), primitives (box / cylinder / sphere) render with no
 * external meshes — the bundled `examples/demo-arm.urdf` is zero-setup. Later
 * phases add the pose tool, servo↔joint binding and the timeline; this is just
 * "see the robot". Code-split so three.js stays out of the initial bundle.
 */
export function RobotView(): JSX.Element {
  const { openFiles, activeId } = useWorkspace()
  const activeFile = openFiles.find((f) => f.id === activeId) ?? null
  const content = activeFile?.content ?? ''

  const mountRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<{ name: string; joints: number; links: number } | null>(null)

  // Parse once per content change (cheap; the scene rebuild below consumes it).
  const parsed = useMemo<{ robot: URDFRobot | null; err: string | null }>(() => {
    if (!content.trim()) return { robot: null, err: 'empty' }
    try {
      const loader = new URDFLoader()
      loader.parseVisual = true
      loader.parseCollision = false
      const robot = loader.parse(content)
      const linkCount = robot ? Object.keys(robot.links).length : 0
      if (!robot || linkCount === 0) return { robot: null, err: 'This file has no URDF links to show.' }
      return { robot, err: null }
    } catch (e) {
      return { robot: null, err: e instanceof Error ? e.message : 'Could not parse this URDF.' }
    }
  }, [content])

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    if (!parsed.robot) {
      setError(parsed.err === 'empty' ? null : parsed.err)
      setInfo(null)
      return
    }
    setError(null)

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x191a1d)

    const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 100)
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    mount.appendChild(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08

    // Lights: soft ambient + a key + a fill so the coloured links read.
    scene.add(new THREE.HemisphereLight(0xffffff, 0x30333a, 0.9))
    const key = new THREE.DirectionalLight(0xffffff, 1.1)
    key.position.set(1.5, 2.5, 1.5)
    scene.add(key)
    const fill = new THREE.DirectionalLight(0x9fb4d0, 0.35)
    fill.position.set(-1.5, 1, -1.2)
    scene.add(fill)

    // The robot. URDF is Z-up; rotate into three's Y-up so it stands up.
    const robot = parsed.robot
    robot.rotation.x = -Math.PI / 2
    scene.add(robot)
    // Flush the world matrices BEFORE measuring — setting rotation only marks
    // them dirty, so an immediate Box3 would frame the un-rotated (stale) box.
    robot.updateMatrixWorld(true)
    setInfo({
      name: robot.robotName || robot.name || 'robot',
      joints: Object.keys(robot.joints).length,
      links: Object.keys(robot.links).length
    })

    // Frame the model: fit the camera to its bounds + a ground grid at its base.
    const box = new THREE.Box3().setFromObject(robot)
    const size = box.getSize(new THREE.Vector3())
    const centre = box.getCenter(new THREE.Vector3())
    const radius = Math.max(size.x, size.y, size.z, 0.1) * 0.5
    const dist = radius / Math.sin((camera.fov * Math.PI) / 180 / 2)
    camera.position.set(centre.x + dist * 0.8, box.max.y + dist * 0.35, centre.z + dist * 1.0)
    controls.target.copy(centre)
    controls.update()

    const gridSize = Math.max(size.x, size.z) * 3 + 0.4
    const grid = new THREE.GridHelper(gridSize, 20, 0x3a3d44, 0x27292e)
    grid.position.y = box.min.y
    scene.add(grid)

    const resize = (): void => {
      const w = mount.clientWidth
      const h = mount.clientHeight
      if (w === 0 || h === 0) return
      // updateStyle defaults true → the canvas CSS size fits the container while
      // the drawing buffer scales by the pixel ratio (passing false made the
      // canvas render at its oversized device-pixel size and overflow).
      renderer.setSize(w, h)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(mount)

    let raf = 0
    const tick = (): void => {
      controls.update()
      renderer.render(scene, camera)
      raf = requestAnimationFrame(tick)
    }
    tick()

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      controls.dispose()
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh
        if (mesh.geometry) mesh.geometry.dispose()
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
        else mat?.dispose()
      })
      renderer.dispose()
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement)
    }
  }, [parsed])

  return (
    <div className="robotview">
      <div className="robotview__canvas" ref={mountRef} />
      {error ? (
        <div className="robotview__overlay robotview__overlay--error" role="alert">
          <p className="robotview__overlay-title">Couldn&apos;t show this robot</p>
          <p className="robotview__overlay-msg">{error}</p>
        </div>
      ) : parsed.err === 'empty' ? (
        <div className="robotview__overlay">
          <p className="robotview__overlay-title">Robot View</p>
          <p className="robotview__overlay-msg">Open a .urdf file to see the 3D model.</p>
        </div>
      ) : (
        info && (
          <div className="robotview__hud" aria-hidden="true">
            <strong>{info.name}</strong> · {info.joints} joints · {info.links} links
            <span className="robotview__hud-hint">drag to orbit · scroll to zoom</span>
          </div>
        )
      )}
    </div>
  )
}

export default RobotView
