/**
 * ROBOT-KIT PART MESH GENERATOR — the Pico 2 W, the MX1508 driver and the
 * 2×2 4×AA battery pack (the three parts of a budget 2WD robot that no vendor
 * publishes a redistributable model for).
 *
 * Like `modulino-mesh.mjs` and `robot-chassis-mesh.mjs`, each model is built
 * with three.js from named dimensions rather than modelled by hand: re-runnable,
 * diffable, tested, and small. The parts that DO have a published model (the
 * TT motor from Adafruit's CAD library, the HC-SR04 from the FreeCAD library)
 * ship that file instead and are not generated here.
 *
 *   node scripts/robot-kit-meshes.mjs --all            # every part below → its model.stl
 *   node scripts/robot-kit-meshes.mjs --part mx1508    # one part folder
 *   node scripts/robot-kit-meshes.mjs --part pico2w --out path.stl
 *
 * FRAME: millimetres, **Z up, the part's underside on z = 0, centred in x/y**,
 * with the model's x/y matching the part's 2-D footprint (`dimensions.width`
 * along x, `dimensions.height` along y, the "top" of the Part Editor picture at
 * +y). A part declares `meshUnits: mm` and needs no `meshRotation` or
 * `meshOffset`, exactly like the Modulino boards.
 *
 * PROVENANCE.
 *   Pico 2 W  — Raspberry Pi's published mechanical drawing (51 × 21 mm, Ø2.1
 *               holes 47 × 11.4 mm apart, 40 castellated pads on a 2.54 mm
 *               pitch, 1 mm board) plus component positions read off the
 *               part's own top-down photo; the wireless module can measures
 *               ~14 × 11 mm on that photo.
 *   MX1508    — the ubiquitous red "HW-354" module: 24.5 × 21 mm listed by the
 *               sellers, the part's photo for what sits where (two Ø6.3 mm
 *               electrolytics, the SOP-16 driver, 2 × 4 signal/motor holes and
 *               the VCC/GND pair), 1.6 mm FR-4.
 *   4×AA pack — the two-over-two holder every chassis kit ships (≈31.5 × 59.5
 *               × 30.5 mm outside; AA cells are Ø14.5 × 50.5 mm), with the
 *               stubs of its red and black leads leaving the top end.
 * Everything is a named constant below, so a measured correction is a one-line
 * change plus a re-run.
 */
import * as THREE from 'three'
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js'

/** Every part folder holds its model under this name. */
export const MESH_FILENAME = 'model.stl'

// --- Geometry helpers -------------------------------------------------------

/** A box of size (sx, sy, sz) centred at (cx, cy, cz). */
function box(sx, sy, sz, cx, cy, cz) {
  const g = new THREE.BoxGeometry(sx, sy, sz)
  g.translate(cx, cy, cz)
  return g
}

/** A cylinder of diameter `d`, length `len`, along `axis`, centred at (cx, cy, cz). */
function cyl(d, len, axis, cx, cy, cz, segments = 32) {
  const g = new THREE.CylinderGeometry(d / 2, d / 2, len, segments)
  if (axis === 'x') g.rotateZ(Math.PI / 2)
  else if (axis === 'z') g.rotateX(Math.PI / 2)
  g.translate(cx, cy, cz)
  return g
}

/** A circular hole path (clockwise, so `Shape` reads it as a hole). */
function holePath(x, y, d) {
  const p = new THREE.Path()
  p.absarc(x, y, d / 2, 0, Math.PI * 2, true)
  return p
}

/** A rounded rectangle centred on the origin, traced counter-clockwise. */
function roundedRect(shape, w, h, r) {
  const x = -w / 2
  const y = -h / 2
  shape.moveTo(x + r, y)
  shape.lineTo(x + w - r, y)
  shape.absarc(x + w - r, y + r, r, -Math.PI / 2, 0, false)
  shape.lineTo(x + w, y + h - r)
  shape.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2, false)
  shape.lineTo(x + r, y + h)
  shape.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI, false)
  shape.lineTo(x, y + r)
  shape.absarc(x + r, y + r, r, Math.PI, 1.5 * Math.PI, false)
  shape.closePath()
  return shape
}

/** A flat PCB: `shape` extruded `thickness` up from z = 0. */
function pcb(shape, thickness) {
  return new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: false,
    curveSegments: 12
  })
}

/** Serialise a group to a BINARY STL (compact — ASCII is ~5× the size). */
export function toStl(group) {
  const data = new STLExporter().parse(group, { binary: true })
  return Buffer.from(data.buffer ?? data)
}

function groupOf(parts) {
  const group = new THREE.Group()
  const mat = new THREE.MeshBasicMaterial()
  for (const { name, geo } of parts) {
    const mesh = new THREE.Mesh(geo, mat)
    mesh.name = name
    group.add(mesh)
  }
  return group
}

// --- Raspberry Pi Pico 2 W ---------------------------------------------------

export const PICO = {
  /** Board outline (x by y), and the 1 mm PCB the Pico family uses. */
  widthMm: 21,
  lengthMm: 51,
  thicknessMm: 1,
  cornerRadiusMm: 1,
  /** Ø2.1 mm mounting holes, 11.4 mm apart across and 47 mm apart along. */
  hole: { diameterMm: 2.1, pitchXMm: 11.4, pitchYMm: 47 },
  /** 20 castellated pads per long edge: Ø1.6 half-holes on a 2.54 mm pitch,
   *  pin 1 centred 1.61 mm from the USB end. */
  pads: { count: 20, pitchMm: 2.54, diameterMm: 1.6, firstFromUsbEndMm: 1.61 },
  /** The three SWD debug pads on the far end, 2.54 mm apart. */
  debug: { count: 3, pitchMm: 2.54, diameterMm: 1.6, fromEndMm: 0 },
  /** Micro-USB B receptacle on the +y end, its lip 1.3 mm proud of the edge. */
  usb: { widthMm: 7.5, depthMm: 5.6, heightMm: 2.6, overhangMm: 1.3 },
  /** BOOTSEL tactile switch: body plus a round white plunger. */
  bootsel: { xMm: -4.6, yMm: 13, bodyMm: 4.5, heightMm: 2, capDiameterMm: 2.2, capHeightMm: 0.6 },
  /** RP2350A, a 7 × 7 mm QFN, near the middle of the board. */
  mcu: { xMm: 0.5, yMm: 2.5, sizeMm: 7, heightMm: 0.9 },
  /** 8-pin SOIC QSPI flash, above the MCU. */
  flash: { xMm: 1.5, yMm: 14.3, widthMm: 5.3, lengthMm: 5.3, heightMm: 1.6 },
  /** Buck-boost inductor beside the flash. */
  inductor: { xMm: 6, yMm: 14.5, sizeMm: 3.5, heightMm: 2 },
  /** The Infineon CYW43439 wireless module's shield can at the far end. */
  can: { xMm: 0.8, yMm: -12.3, widthMm: 14.4, lengthMm: 11.4, heightMm: 1.8 },
  /** The user LED (on the module on a Pico W; drawn beside the USB here). */
  led: { xMm: -5.6, yMm: 19.4, widthMm: 1.6, lengthMm: 0.8, heightMm: 0.6 }
}

/** The Pico outline with its mounting holes; castellations are cut as notches. */
export function picoShape(p = PICO) {
  const W = p.widthMm / 2
  const L = p.lengthMm / 2
  const r = p.cornerRadiusMm
  const pr = p.pads.diameterMm / 2
  const padY = (i) => L - p.pads.firstFromUsbEndMm - i * p.pads.pitchMm
  const s = new THREE.Shape()
  // Bottom edge (y = −L), left to right, with the three debug pads.
  s.moveTo(-W + r, -L)
  for (let i = 0; i < p.debug.count; i++) {
    const x = (i - (p.debug.count - 1) / 2) * p.debug.pitchMm
    s.lineTo(x - pr, -L)
    s.absarc(x, -L, pr, Math.PI, 0, true)
  }
  s.lineTo(W - r, -L)
  s.absarc(W - r, -L + r, r, -Math.PI / 2, 0, false)
  // Right edge (x = +W), bottom to top, notched for each pad.
  for (let i = p.pads.count - 1; i >= 0; i--) {
    const y = padY(i)
    s.lineTo(W, y - pr)
    s.absarc(W, y, pr, -Math.PI / 2, Math.PI / 2, true)
  }
  s.lineTo(W, L - r)
  s.absarc(W - r, L - r, r, 0, Math.PI / 2, false)
  // Top (USB) edge, right to left.
  s.lineTo(-W + r, L)
  s.absarc(-W + r, L - r, r, Math.PI / 2, Math.PI, false)
  // Left edge (x = −W), top to bottom.
  for (let i = 0; i < p.pads.count; i++) {
    const y = padY(i)
    s.lineTo(-W, y + pr)
    s.absarc(-W, y, pr, Math.PI / 2, 1.5 * Math.PI, true)
  }
  s.lineTo(-W, -L + r)
  s.absarc(-W + r, -L + r, r, Math.PI, 1.5 * Math.PI, false)
  s.closePath()
  for (const sx of [-1, 1])
    for (const sy of [-1, 1])
      s.holes.push(
        holePath((sx * p.hole.pitchXMm) / 2, (sy * p.hole.pitchYMm) / 2, p.hole.diameterMm)
      )
  return s
}

export function picoGeometries(p = PICO) {
  const t = p.thicknessMm
  const L = p.lengthMm / 2
  const out = [{ name: 'pcb', geo: pcb(picoShape(p), t) }]
  const u = p.usb
  out.push({
    name: 'usb',
    geo: box(
      u.widthMm,
      u.depthMm,
      u.heightMm,
      0,
      L - u.depthMm / 2 + u.overhangMm,
      t + u.heightMm / 2
    )
  })
  const b = p.bootsel
  out.push({
    name: 'bootsel',
    geo: box(b.bodyMm, b.bodyMm, b.heightMm, b.xMm, b.yMm, t + b.heightMm / 2)
  })
  out.push({
    name: 'bootsel-cap',
    geo: cyl(
      b.capDiameterMm,
      b.capHeightMm,
      'z',
      b.xMm,
      b.yMm,
      t + b.heightMm + b.capHeightMm / 2,
      24
    )
  })
  const m = p.mcu
  out.push({
    name: 'rp2350',
    geo: box(m.sizeMm, m.sizeMm, m.heightMm, m.xMm, m.yMm, t + m.heightMm / 2)
  })
  const f = p.flash
  out.push({
    name: 'flash',
    geo: box(f.widthMm, f.lengthMm, f.heightMm, f.xMm, f.yMm, t + f.heightMm / 2)
  })
  const i = p.inductor
  out.push({
    name: 'inductor',
    geo: box(i.sizeMm, i.sizeMm, i.heightMm, i.xMm, i.yMm, t + i.heightMm / 2)
  })
  const c = p.can
  out.push({
    name: 'wireless-can',
    geo: box(c.widthMm, c.lengthMm, c.heightMm, c.xMm, c.yMm, t + c.heightMm / 2)
  })
  const l = p.led
  out.push({
    name: 'led',
    geo: box(l.widthMm, l.lengthMm, l.heightMm, l.xMm, l.yMm, t + l.heightMm / 2)
  })
  return out
}

// --- MX1508 dual H-bridge module ---------------------------------------------

export const MX1508 = {
  widthMm: 24.5,
  lengthMm: 21,
  thicknessMm: 1.6,
  cornerRadiusMm: 1,
  /** Ø1 mm plated holes: the IN1–IN4 row on the left, the motor row on the
   *  right, the VCC/GND pair top-left. Positions are the part's pin positions
   *  in the same frame (mm from the board centre, +y up). */
  pinHoleDiameterMm: 1,
  inputs: { xMm: -6.6, ysMm: [-0.3, -2.9, -5.9, -8.5] },
  outputs: { xMm: 8.1, ysMm: [-0.3, -2.9, -5.9, -8.5] },
  power: { xMm: -9.9, ysMm: [8.4, 5] },
  /** One Ø2 mm mounting hole on the left. */
  mountHole: { xMm: -9.6, yMm: 2.2, diameterMm: 2 },
  /** The two 100 µF 16 V electrolytics along the top. */
  caps: {
    diameterMm: 6.3,
    heightMm: 7,
    positions: [
      [-3.2, 5.9],
      [2.9, 5.9]
    ]
  },
  /** The MX1508 driver, an SOP-16 standing along y. */
  ic: { xMm: -0.9, yMm: 0.5, widthMm: 3.9, lengthMm: 9.9, heightMm: 1.5 },
  /** The row of 0603 passives under the caps. */
  passive: {
    widthMm: 1.6,
    lengthMm: 0.8,
    heightMm: 0.6,
    positions: [
      [-8, 1],
      [4.5, 0.5],
      [4.5, -1],
      [5.8, 2.5]
    ]
  }
}

export function mx1508Shape(m = MX1508) {
  const s = roundedRect(new THREE.Shape(), m.widthMm, m.lengthMm, m.cornerRadiusMm)
  for (const y of m.inputs.ysMm) s.holes.push(holePath(m.inputs.xMm, y, m.pinHoleDiameterMm))
  for (const y of m.outputs.ysMm) s.holes.push(holePath(m.outputs.xMm, y, m.pinHoleDiameterMm))
  for (const y of m.power.ysMm) s.holes.push(holePath(m.power.xMm, y, m.pinHoleDiameterMm))
  s.holes.push(holePath(m.mountHole.xMm, m.mountHole.yMm, m.mountHole.diameterMm))
  return s
}

export function mx1508Geometries(m = MX1508) {
  const t = m.thicknessMm
  const out = [{ name: 'pcb', geo: pcb(mx1508Shape(m), t) }]
  m.caps.positions.forEach(([x, y], i) =>
    out.push({
      name: `cap-${i + 1}`,
      geo: cyl(m.caps.diameterMm, m.caps.heightMm, 'z', x, y, t + m.caps.heightMm / 2)
    })
  )
  const ic = m.ic
  out.push({
    name: 'mx1508',
    geo: box(ic.widthMm, ic.lengthMm, ic.heightMm, ic.xMm, ic.yMm, t + ic.heightMm / 2)
  })
  m.passive.positions.forEach(([x, y], i) =>
    out.push({
      name: `passive-${i + 1}`,
      geo: box(
        m.passive.widthMm,
        m.passive.lengthMm,
        m.passive.heightMm,
        x,
        y,
        t + m.passive.heightMm / 2
      )
    })
  )
  return out
}

// --- 4×AA battery pack (two over two) ----------------------------------------

export const AA_PACK = {
  /** Outside of the black holder (x by y), stood on its floor. */
  widthMm: 31.5,
  lengthMm: 59.5,
  /** Floor and wall thickness of the moulding. */
  wallMm: 1.5,
  /** The end walls that carry the contact springs. */
  endWallMm: 4.5,
  /** The centre rib between the two columns of cells. */
  ribMm: 1.2,
  /** An AA cell, and the two layers it sits in. */
  cell: { diameterMm: 14.5, lengthMm: 50.5, nubDiameterMm: 5.5, nubMm: 1 },
  layers: 2,
  /** The pair of Ø1.6 leads leaving the +y end — only their 8 mm stubs, so
   *  the model's footprint stays the holder's (the leads go wherever the wiring
   *  does). */
  leads: { diameterMm: 1.6, lengthMm: 8, spacingMm: 6, xMm: 8 }
}

/** Total holder height: floor + two stacked cells. */
export function aaPackHeightMm(p = AA_PACK) {
  return p.wallMm + p.layers * p.cell.diameterMm
}

export function aaPackGeometries(p = AA_PACK) {
  const W = p.widthMm
  const L = p.lengthMm
  const H = aaPackHeightMm(p)
  const out = []
  out.push({ name: 'floor', geo: box(W, L, p.wallMm, 0, 0, p.wallMm / 2) })
  for (const sy of [-1, 1])
    out.push({
      name: sy > 0 ? 'end-top' : 'end-bottom',
      geo: box(W, p.endWallMm, H, 0, (sy * (L - p.endWallMm)) / 2, H / 2)
    })
  // Side rails run the length at each cell layer's floor, holding the cells in.
  for (const sx of [-1, 1])
    for (let layer = 0; layer < p.layers; layer++)
      out.push({
        name: `rail-${layer}-${sx > 0 ? 'r' : 'l'}`,
        geo: box(
          p.wallMm,
          L,
          3,
          (sx * (W - p.wallMm)) / 2,
          0,
          p.wallMm + layer * p.cell.diameterMm + 1.5
        )
      })
  out.push({ name: 'rib', geo: box(p.ribMm, L, H, 0, 0, H / 2) })
  // Four cells, two per layer, side by side.
  const cellX = (W - p.ribMm) / 4 + p.ribMm / 2
  const cellY = 0
  for (let layer = 0; layer < p.layers; layer++)
    for (const sx of [-1, 1]) {
      const z = p.wallMm + layer * p.cell.diameterMm + p.cell.diameterMm / 2
      const name = `cell-${layer}-${sx > 0 ? 'r' : 'l'}`
      out.push({ name, geo: cyl(p.cell.diameterMm, p.cell.lengthMm, 'y', sx * cellX, cellY, z) })
      // The positive nub alternates ends so the cells read as a series chain.
      const nubEnd = sx * (layer % 2 === 0 ? 1 : -1)
      out.push({
        name: `${name}-nub`,
        geo: cyl(
          p.cell.nubDiameterMm,
          p.cell.nubMm,
          'y',
          sx * cellX,
          (nubEnd * (p.cell.lengthMm + p.cell.nubMm)) / 2,
          z,
          16
        )
      })
    }
  // Leads out of the top end.
  for (const [i, sx] of [-1, 1].entries())
    out.push({
      name: i === 0 ? 'lead-red' : 'lead-black',
      geo: cyl(
        p.leads.diameterMm,
        p.leads.lengthMm,
        'y',
        p.leads.xMm + (sx * p.leads.spacingMm) / 2,
        L / 2 + p.leads.lengthMm / 2,
        H - 4,
        12
      )
    })
  return out
}

// --- Registry ------------------------------------------------------------------

/** Part id → the geometries its model is made of, and its expected footprint. */
export const PARTS = {
  pico2w: { footprint: [PICO.widthMm, PICO.lengthMm], build: () => picoGeometries() },
  mx1508: { footprint: [MX1508.widthMm, MX1508.lengthMm], build: () => mx1508Geometries() },
  'battery-aa-4': {
    footprint: [AA_PACK.widthMm, AA_PACK.lengthMm],
    build: () => aaPackGeometries()
  }
}

/** The assembled model of one part as a three.js group. */
export function partGroup(partId) {
  const entry = PARTS[partId]
  if (!entry) throw new Error(`Unknown part "${partId}". Known: ${Object.keys(PARTS).join(', ')}`)
  return groupOf(entry.build())
}

// --- CLI -------------------------------------------------------------------
// Node-only imports stay inside main() so the geometry above can be loaded by
// the tests without the CLI running — or writing an STL — as a side effect.
async function main(args) {
  const { writeFileSync, mkdirSync } = await import('node:fs')
  const { dirname, resolve } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')

  const flag = (name) => {
    const i = args.indexOf(`--${name}`)
    return i >= 0 ? (args[i + 1] ?? '') : undefined
  }
  const write = (partId, out) => {
    const stl = toStl(partGroup(partId))
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, stl)
    console.log(
      `${out.replace(`${repo}/`, '')} — ${(stl.length - 84) / 50} triangles, ${(stl.length / 1024).toFixed(1)} KB`
    )
  }
  const ids = args.includes('--all') ? Object.keys(PARTS) : flag('part') ? [flag('part')] : []
  if (ids.length === 0) {
    console.error(`Usage: --all | --part <${Object.keys(PARTS).join('|')}> [--out path.stl]`)
    process.exitCode = 1
    return
  }
  for (const id of ids) {
    const out = resolve(
      repo,
      (ids.length === 1 && flag('out')) || `examples/parts/snakie-standard/${id}/${MESH_FILENAME}`
    )
    write(id, out)
  }
}

if (typeof process !== 'undefined' && process.argv?.[1]) {
  const { fileURLToPath } = await import('node:url')
  const { resolve } = await import('node:path')
  if (resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main(process.argv.slice(2))
}
