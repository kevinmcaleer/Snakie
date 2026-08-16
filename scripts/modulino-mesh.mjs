/**
 * MODULINO BOARD MESH GENERATOR (#722, epic #721).
 *
 * Every Arduino Modulino is the SAME 41 × 25.36 × 1.6 mm board — four mounting
 * holes on a 16 × 32 mm pitch and a QWIIC socket at each end — with only the
 * top-side hardware differing. So the mesh is generated from those numbers
 * rather than modelled twelve times: re-runnable, diffable, and a fraction of
 * the size of a hand-modelled STL (sg90's is 360 KB).
 *
 * Geometry is built with three.js — already a dependency, so its `Shape`
 * (rounded outline + circular holes) and `ExtrudeGeometry` do the triangulation
 * no hand-rolled polygon code should have to.
 *
 *   node scripts/modulino-mesh.mjs --all                    # every modulino-* part
 *   node scripts/modulino-mesh.mjs --part modulino-buttons  # one part folder
 *   node scripts/modulino-mesh.mjs --topper knob            # + raised hardware
 *   node scripts/modulino-mesh.mjs --out path/to.stl        # anywhere
 *   node scripts/modulino-mesh.mjs --list                   # known toppers
 *
 * UNITS: millimetres, board bottom on z = 0, centred in x/y — so a part
 * declares `meshUnits: mm` and its link origin sits on the board's underside
 * (the same convention the footprint-box placeholders use, #716).
 *
 * PROVENANCE: the dimensions come from Arduino's product pages via #721, NOT a
 * mechanical drawing — Arduino publish STEP/CAD per module, and #722 carries a
 * checkbox to verify these against them. Everything is a named constant below
 * so a correction is a one-line change plus a re-run.
 */
import { writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as THREE from 'three'
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')

/** Every Modulino part folder holds its copy under this name. */
export const MESH_FILENAME = 'modulino.stl'

/** The shared Modulino PCB. Every number here is from #721; see PROVENANCE. */
export const BOARD = {
  /** Along x — the long axis the QWIIC sockets sit on. */
  lengthMm: 41,
  /** Along y. */
  widthMm: 25.36,
  /** Along z (standard 1.6 mm FR-4). */
  thicknessMm: 1.6,
  /** Outline corner radius. Measured in the Part Editor against a real board
   *  photo (#735) — it replaced a 2 mm guess eyeballed from product shots. The
   *  parts state the same number, and the conformance test holds them equal. */
  cornerRadiusMm: 4.6,
  /** Ø3.2 mm mounting holes on a 16 (y) × 32 (x) mm pitch, so centres sit at
   *  (±16, ±8) — 4.5 mm from each end, 4.68 mm from each side. */
  holeDiameterMm: 3.2,
  holePitchXMm: 32,
  holePitchYMm: 16
}

/**
 * The QWIIC housing at each end — a JST **SH** series 4-circuit side-entry SMT
 * header, `SM04B-SRSS-TB`. Unlike the board outline, these are straight off
 * JST's own drawing rather than a product page: the header table gives
 * `B = A + 3.0` for every circuit count (so 3.0 mm of contact span → 6.0 mm
 * overall), and the side-entry body is 4.25 mm deep by 2.9 mm tall.
 *
 * #721's "≈ 4.5 mm wide" is neither of those, and the renderer's connector
 * table had the same trouble — it used the 2.9 mm HEIGHT as the board depth.
 * Kept in step with `JST_DIMS.sh` in `part-editor.util.ts`.
 */
export const CONNECTOR = {
  /** Along x, into the board from its end. */
  depthMm: 4.25,
  /** Along y, across the four contacts (the datasheet's B for 4 circuits). */
  widthMm: 6.0,
  /** Above the PCB's top face. */
  heightMm: 2.9
}

/**
 * Raised top-side hardware, per epic #721's policy (b): one shared flat PCB,
 * plus a simple topper for the three modules that genuinely aren't flat, rather
 * than twelve full models (a bare PCB would read wrong) or none (a Joystick
 * that looks like a blank board). Each per-module issue adds its own entry —
 * these are deliberately simple primitives, not attempts at real components.
 *
 * `kind: 'box'`   → w/d/h millimetres, centred at (x, y) on the board's top.
 * `kind: 'cylinder'` → diameter/height, centred at (x, y).
 */
export const TOPPERS = {
  // #726 Modulino Joystick — the thumbstick's base + cap.
  joystick: [
    { kind: 'box', w: 12, d: 12, h: 5, x: 0, y: 0 },
    { kind: 'cylinder', diameter: 9, h: 4, x: 0, y: 0, z: 5 }
  ],
  // #727 Modulino Knob — the rotary encoder body + its cap.
  knob: [
    { kind: 'box', w: 12, d: 12, h: 6.5, x: 0, y: 0 },
    { kind: 'cylinder', diameter: 12, h: 6, x: 0, y: 0, z: 6.5 }
  ],
  // #734 Modulino Vibro — the vibration motor can, lying flat.
  vibro: [{ kind: 'cylinder', diameter: 10, h: 3.4, x: 0, y: 0 }]
}

/** Trace a rounded rectangle centred on the origin into `ctx` (CCW). */
function roundedRect(ctx, w, h, r) {
  const x = -w / 2
  const y = -h / 2
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.absarc(x + w - r, y + r, r, -Math.PI / 2, 0, false)
  ctx.lineTo(x + w, y + h - r)
  ctx.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2, false)
  ctx.lineTo(x + r, y + h)
  ctx.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI, false)
  ctx.lineTo(x, y + r)
  ctx.absarc(x + r, y + r, r, Math.PI, 1.5 * Math.PI, false)
  return ctx
}

/** The bare PCB: rounded outline, four through-holes, extruded to thickness. */
export function boardGeometry(board = BOARD) {
  const shape = roundedRect(
    new THREE.Shape(),
    board.lengthMm,
    board.widthMm,
    board.cornerRadiusMm
  )
  const hx = board.holePitchXMm / 2
  const hy = board.holePitchYMm / 2
  for (const [cx, cy] of [
    [-hx, -hy],
    [hx, -hy],
    [hx, hy],
    [-hx, hy]
  ]) {
    const hole = new THREE.Path()
    // Clockwise, i.e. opposite the outline, so it reads as a hole.
    hole.absarc(cx, cy, board.holeDiameterMm / 2, 0, Math.PI * 2, true)
    shape.holes.push(hole)
  }
  // ExtrudeGeometry runs +z from 0, which puts the board's underside on z = 0.
  return new THREE.ExtrudeGeometry(shape, {
    depth: board.thicknessMm,
    bevelEnabled: false,
    curveSegments: 16
  })
}

/** A QWIIC housing at each END of the board, flush with the outer edge. */
export function connectorGeometries(board = BOARD, conn = CONNECTOR) {
  const out = []
  for (const sign of [-1, 1]) {
    const geo = new THREE.BoxGeometry(conn.depthMm, conn.widthMm, conn.heightMm)
    geo.translate(
      sign * (board.lengthMm / 2 - conn.depthMm / 2),
      0,
      board.thicknessMm + conn.heightMm / 2
    )
    out.push(geo)
  }
  return out
}

/** Build one topper primitive, sitting on the board's top face. */
function topperGeometry(spec, board = BOARD) {
  const baseZ = board.thicknessMm + (spec.z ?? 0)
  if (spec.kind === 'cylinder') {
    const r = spec.diameter / 2
    const geo = new THREE.CylinderGeometry(r, r, spec.h, 24)
    geo.rotateX(Math.PI / 2) // three's cylinder runs along y; stand it on z
    geo.translate(spec.x ?? 0, spec.y ?? 0, baseZ + spec.h / 2)
    return geo
  }
  const geo = new THREE.BoxGeometry(spec.w, spec.d, spec.h)
  geo.translate(spec.x ?? 0, spec.y ?? 0, baseZ + spec.h / 2)
  return geo
}

/** The whole module as a three.js Group: PCB + both QWIIC housings + topper. */
export function modulinoGroup(topper) {
  const group = new THREE.Group()
  const mat = new THREE.MeshBasicMaterial()
  group.add(new THREE.Mesh(boardGeometry(), mat))
  for (const geo of connectorGeometries()) group.add(new THREE.Mesh(geo, mat))
  for (const spec of TOPPERS[topper] ?? []) group.add(new THREE.Mesh(topperGeometry(spec), mat))
  return group
}

/** Serialise a group to a BINARY STL (compact — ASCII is ~5× the size). */
export function toStl(group) {
  const data = new STLExporter().parse(group, { binary: true })
  return Buffer.from(data.buffer ?? data)
}

// --- CLI -------------------------------------------------------------------
// Guarded so the geometry above can be imported by tests without the CLI
// running (and writing an STL) as a side effect of the import.
function main(args) {
  const flag = (name) => {
    const i = args.indexOf(`--${name}`)
    return i >= 0 ? (args[i + 1] ?? '') : undefined
  }

  if (args.includes('--list')) {
    console.log(`Toppers: ${Object.keys(TOPPERS).join(', ') || '(none)'}`)
    return
  }

  const write = (out, topper) => {
    const stl = toStl(modulinoGroup(topper))
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, stl)
    console.log(
      `${out.replace(`${REPO}/`, '')} — ${(stl.length - 84) / 50} triangles, ` +
        `${(stl.length / 1024).toFixed(1)} KB${topper ? ` (topper: ${topper})` : ''}`
    )
  }

  // --all: refresh every Modulino part's copy. The mesh is duplicated per part
  // folder rather than shared (Part.mesh is a filename WITHIN the part folder),
  // which is affordable precisely because it's generated and small — so adding
  // a module is: make the folder, re-run this. The topper, if any, is chosen by
  // the folder's suffix, so `modulino-knob/` picks up the knob topper.
  if (args.includes('--all')) {
    const libDir = resolve(REPO, 'examples/parts/snakie-standard')
    const dirs = readdirSync(libDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name.startsWith('modulino-'))
      .filter((e) => existsSync(resolve(libDir, e.name, 'parts.yml')))
    if (dirs.length === 0) console.log('No modulino-* parts yet.')
    for (const d of dirs) {
      const suffix = d.name.slice('modulino-'.length)
      write(resolve(libDir, d.name, MESH_FILENAME), TOPPERS[suffix] ? suffix : undefined)
    }
    return
  }

  const topper = flag('topper')
  if (topper !== undefined && !TOPPERS[topper]) {
    console.error(`Unknown topper "${topper}". Known: ${Object.keys(TOPPERS).join(', ')}`)
    process.exitCode = 1
    return
  }
  const part = flag('part')
  const out = resolve(
    REPO,
    flag('out') ??
      (part
        ? `examples/parts/snakie-standard/${part}/${MESH_FILENAME}`
        : `build/${MESH_FILENAME}`)
  )
  write(out, topper)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2))
}
