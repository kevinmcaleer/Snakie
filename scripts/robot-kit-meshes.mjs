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
 * It also builds the two Open Duck Mini bus-servo parts, the Feetech STS3215 and
 * the Waveshare Bus Servo Adapter (A). Feetech and Waveshare publish drawings
 * but no model licensed for redistribution, so these are modelled the same way.
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
 *   STS3215   — Feetech's listed 45.2 × 24.7 × 35 mm case, with the horn,
 *               the two 5264-3P ports, the recessed lower panel and the four
 *               M2 face holes placed off the part's own photo (the same photo
 *               its Board View drawing uses). Z is the 35 mm axis, so the
 *               horn face is the top, as the part is drawn.
 *   Bus Servo Adapter (A) — the 42 × 34 mm board from Waveshare's wiki, 1.6 mm
 *               FR-4, with every part read off its top-down photo: the two
 *               5264-3P servo ports, the TX/RX/GND header, the A/B jumper
 *               block, the DC jack, the 3.5 mm DC+/DC- terminal, the USB-C
 *               receptacle and the larger chips.
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

// --- Feetech STS3215 bus servo -------------------------------------------------

/** Photo position → model mm. The part's picture is `w` × `h` mm with its top at
 *  +y; `fx`/`fy` are fractions across / down it, as the 2-D part stores them. */
const atX = (w, fx) => fx * w - w / 2
const atY = (h, fy) => h / 2 - fy * h

export const STS3215 = {
  /** The case: 24.7 wide (x) by 45.2 long (y), 33 mm to the horn face. */
  widthMm: 24.7,
  lengthMm: 45.2,
  caseHeightMm: 33,
  cornerRadiusMm: 2,
  /** The horn face is a 1 mm skin carrying the four M2 holes, so they read as
   *  holes rather than painted dots. Centres as fractions of the photo. */
  faceMm: 1,
  faceHoles: { diameterMm: 2, at: [[0.075, 0.415], [0.925, 0.415], [0.075, 0.955], [0.925, 0.955]] },
  /** The output: a raised boss and the Ø19 aluminium horn (four Ø3 holes on a
   *  12 mm circle, a Ø5 centre bore), 10 mm in from the output end. Case + boss
   *  + horn = the listed 35 mm. */
  horn: { yFrac: 0.222, diameterMm: 19, thicknessMm: 1.5, bossDiameterMm: 11, bossMm: 0.5, holeMm: 3, holeCircleMm: 12, boreMm: 5 },
  /** The two 5264-3P ports (white, ~10 × 4.9 mm), standing 1.2 mm proud of the
   *  face, centred on the contact rows of the 2-D part. */
  port: { widthMm: 9.9, depthMm: 4.9, proudMm: 1.2, yFrac: 0.532, xFracs: [0.296, 0.705] },
  /** The raised label panel on the lower half of the face. */
  panel: { widthMm: 17.9, lengthMm: 11.7, yFrac: 0.79, proudMm: 0.6 },
  /** The bottom cover's seam: a band 4 mm up, a touch inset. */
  cover: { heightMm: 4, insetMm: 0.3 }
}

/** Total height to the top of the horn. */
export function sts3215HeightMm(s = STS3215) {
  return s.caseHeightMm + s.horn.bossMm + s.horn.thicknessMm
}

export function sts3215Geometries(s = STS3215) {
  const W = s.widthMm
  const L = s.lengthMm
  const out = []
  // Bottom cover, then the case, then the horn face with its four holes.
  out.push({
    name: 'cover',
    geo: pcb(roundedRect(new THREE.Shape(), W - 2 * s.cover.insetMm, L - 2 * s.cover.insetMm, s.cornerRadiusMm), s.cover.heightMm)
  })
  const caseBody = pcb(roundedRect(new THREE.Shape(), W, L, s.cornerRadiusMm), s.caseHeightMm - s.faceMm - s.cover.heightMm)
  caseBody.translate(0, 0, s.cover.heightMm)
  out.push({ name: 'case', geo: caseBody })
  const face = roundedRect(new THREE.Shape(), W, L, s.cornerRadiusMm)
  for (const [fx, fy] of s.faceHoles.at) face.holes.push(holePath(atX(W, fx), atY(L, fy), s.faceHoles.diameterMm))
  const faceGeo = pcb(face, s.faceMm)
  faceGeo.translate(0, 0, s.caseHeightMm - s.faceMm)
  out.push({ name: 'face', geo: faceGeo })
  // Horn: boss, then the disc with its holes.
  const h = s.horn
  const hy = atY(L, h.yFrac)
  const top = s.caseHeightMm
  out.push({ name: 'horn-boss', geo: cyl(h.bossDiameterMm, h.bossMm, 'z', 0, hy, top + h.bossMm / 2, 32) })
  const disc = new THREE.Shape()
  disc.absarc(0, 0, h.diameterMm / 2, 0, Math.PI * 2, false)
  disc.holes.push(holePath(0, 0, h.boreMm))
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2
    disc.holes.push(holePath((Math.cos(a) * h.holeCircleMm) / 2, (Math.sin(a) * h.holeCircleMm) / 2, h.holeMm))
  }
  const discGeo = new THREE.ExtrudeGeometry(disc, { depth: h.thicknessMm, bevelEnabled: false, curveSegments: 24 })
  discGeo.translate(0, hy, top + h.bossMm)
  out.push({ name: 'horn', geo: discGeo })
  // The two bus ports.
  const p = s.port
  p.xFracs.forEach((fx, i) =>
    out.push({
      name: `port-${i + 1}`,
      geo: box(p.widthMm, p.depthMm, p.proudMm, atX(W, fx), atY(L, p.yFrac), top + p.proudMm / 2)
    })
  )
  const pn = s.panel
  out.push({ name: 'panel', geo: box(pn.widthMm, pn.lengthMm, pn.proudMm, 0, atY(L, pn.yFrac), top + pn.proudMm / 2) })
  return out
}

// --- Waveshare Bus Servo Adapter (A) -----------------------------------------------

export const BUS_ADAPTER = {
  widthMm: 42,
  lengthMm: 34,
  thicknessMm: 1.6,
  cornerRadiusMm: 2,
  /** Ø3 corner holes, at the 2-D part's mounting-hole positions. */
  holes: { diameterMm: 3, at: [[0.065, 0.08], [0.926, 0.08], [0.065, 0.897], [0.926, 0.897]] },
  /** Two vertical 5264-3P servo ports along the top edge. */
  servoPort: { widthMm: 9.9, depthMm: 4.9, heightMm: 6, yFrac: 0.085, xFracs: [0.251, 0.536] },
  /** The TX/RX/GND 0.1" header: black base, three square posts. */
  uart: { xFrac: 0.796, yFrac: 0.052, pitchMm: 2.54, baseMm: 2.5, postMm: 0.64, postHeightMm: 6 },
  /** The A/B mode jumpers: a 2 × 3 header with two yellow shunts on the B rows. */
  jumper: { xFrac: 0.86, yFrac: 0.48, pitchMm: 2.54, baseMm: 2.5, postHeightMm: 6, shunt: { widthMm: 2.5, lengthMm: 5, heightMm: 6 } },
  /** The 5.5 × 2.1 mm DC barrel jack, its mouth just past the bottom edge. */
  dcJack: { xFrac: 0.24, topFrac: 0.555, widthMm: 9, lengthMm: 14.5, heightMm: 11, barrelMm: 6.4, overhangMm: 0.5 },
  /** The 2-way 3.5 mm DC+/DC- screw terminal. */
  terminal: { xFrac: 0.5, widthMm: 7.2, lengthMm: 7.6, heightMm: 8.5, overhangMm: 0.3, screwMm: 2.8 },
  /** USB-C receptacle, 0.6 mm proud of the bottom edge. */
  usb: { xFrac: 0.755, widthMm: 8.9, lengthMm: 7.35, heightMm: 3.2, overhangMm: 0.6 },
  /** The larger chips, as [name, xFrac, yFrac, w, l, h]. */
  chips: [
    ['regulator', 0.585, 0.285, 6.5, 3.5, 1.6],
    ['regulator-tab', 0.585, 0.225, 3.2, 1.5, 1.6],
    ['buck', 0.498, 0.69, 4.9, 3.9, 1.5],
    ['inductor', 0.61, 0.745, 4, 4, 2],
    ['ch343', 0.72, 0.6, 3, 3, 0.9],
    ['diode', 0.045, 0.76, 2.6, 4.3, 2],
    ['buffer-1', 0.13, 0.415, 2.9, 1.6, 1.1],
    ['buffer-2', 0.32, 0.415, 2.9, 1.6, 1.1]
  ]
}

export function busAdapterGeometries(a = BUS_ADAPTER) {
  const W = a.widthMm
  const L = a.lengthMm
  const t = a.thicknessMm
  const board = roundedRect(new THREE.Shape(), W, L, a.cornerRadiusMm)
  for (const [fx, fy] of a.holes.at) board.holes.push(holePath(atX(W, fx), atY(L, fy), a.holes.diameterMm))
  const out = [{ name: 'pcb', geo: pcb(board, t) }]
  const sp = a.servoPort
  sp.xFracs.forEach((fx, i) =>
    out.push({
      name: `servo-port-${i + 1}`,
      geo: box(sp.widthMm, sp.depthMm, sp.heightMm, atX(W, fx), atY(L, sp.yFrac), t + sp.heightMm / 2)
    })
  )
  // UART header: base + three posts.
  const u = a.uart
  const ux = atX(W, u.xFrac)
  const uy = atY(L, u.yFrac)
  out.push({ name: 'uart-base', geo: box(3 * u.pitchMm, u.pitchMm, u.baseMm, ux, uy, t + u.baseMm / 2) })
  for (let i = -1; i <= 1; i++)
    out.push({
      name: `uart-pin-${i + 2}`,
      geo: box(u.postMm, u.postMm, u.postHeightMm, ux + i * u.pitchMm, uy, t + u.postHeightMm / 2)
    })
  // Jumper block: base, then a shunt over each column's lower pair.
  const j = a.jumper
  const jx = atX(W, j.xFrac)
  const jy = atY(L, j.yFrac)
  out.push({ name: 'jumper-base', geo: box(2 * j.pitchMm, 3 * j.pitchMm, j.baseMm, jx, jy, t + j.baseMm / 2) })
  for (const sx of [-0.5, 0.5]) {
    out.push({
      name: `jumper-pin-${sx < 0 ? 'l' : 'r'}`,
      geo: box(0.64, 0.64, j.postHeightMm, jx + sx * j.pitchMm, jy + j.pitchMm, t + j.postHeightMm / 2)
    })
    out.push({
      name: `jumper-shunt-${sx < 0 ? 'l' : 'r'}`,
      geo: box(j.shunt.widthMm, j.shunt.lengthMm, j.shunt.heightMm, jx + sx * j.pitchMm, jy - j.pitchMm / 2, t + j.baseMm + j.shunt.heightMm / 2 - 2)
    })
  }
  // DC jack: body plus the barrel mouth facing -y.
  const d = a.dcJack
  const dx = atX(W, d.xFrac)
  const dTop = atY(L, d.topFrac)
  const dCy = dTop - d.lengthMm / 2
  out.push({ name: 'dc-jack', geo: box(d.widthMm, d.lengthMm, d.heightMm, dx, dCy, t + d.heightMm / 2) })
  out.push({ name: 'dc-jack-mouth', geo: cyl(d.barrelMm, d.overhangMm + 0.5, 'y', dx, dTop - d.lengthMm - d.overhangMm / 2 + 0.25, t + d.heightMm / 2, 24) })
  // Terminal block with two screw heads on top.
  const tb = a.terminal
  const tx = atX(W, tb.xFrac)
  const ty = -L / 2 + tb.lengthMm / 2 - tb.overhangMm
  out.push({ name: 'terminal', geo: box(tb.widthMm, tb.lengthMm, tb.heightMm, tx, ty, t + tb.heightMm / 2) })
  for (const sx of [-1, 1])
    out.push({
      name: `terminal-screw-${sx < 0 ? 1 : 2}`,
      geo: cyl(tb.screwMm, 0.4, 'z', tx + (sx * tb.widthMm) / 4, ty + 1, t + tb.heightMm + 0.2, 20)
    })
  // USB-C.
  const us = a.usb
  out.push({
    name: 'usb-c',
    geo: box(us.widthMm, us.lengthMm, us.heightMm, atX(W, us.xFrac), -L / 2 + us.lengthMm / 2 - us.overhangMm, t + us.heightMm / 2)
  })
  for (const [name, fx, fy, w, l, h] of a.chips)
    out.push({ name, geo: box(w, l, h, atX(W, fx), atY(L, fy), t + h / 2) })
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
  },
  'sts3215-bus-servo': {
    footprint: [STS3215.widthMm, STS3215.lengthMm],
    build: () => sts3215Geometries()
  },
  'waveshare-bus-servo-adapter': {
    footprint: [BUS_ADAPTER.widthMm, BUS_ADAPTER.lengthMm],
    build: () => busAdapterGeometries()
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
