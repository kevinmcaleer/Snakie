/**
 * 2WD ROBOT CAR CHASSIS MESH GENERATOR — the clear-acrylic "smart car" kit.
 *
 * The ubiquitous budget robot base: a laser-cut acrylic plate, two yellow TT
 * gear motors on T-brackets, two Ø65 mm yellow wheels rising through notches in
 * the plate's sides, a steel-ball caster under the nose on brass standoffs and
 * a 4×AA battery box on top. Sold under dozens of names (DollaTek, Emgreat,
 * Elegoo, diymore, "2WD Smart Robot Car Chassis Kit", …) and all cut to the same
 * pattern, so — like `modulino-mesh.mjs` — the model is generated from named
 * numbers rather than modelled by hand: re-runnable, diffable, tested, and a
 * fraction of the size of a downloaded STL.
 *
 *   node scripts/robot-chassis-mesh.mjs                # → the part folder's model.stl
 *   node scripts/robot-chassis-mesh.mjs --out path.stl # anywhere
 *   node scripts/robot-chassis-mesh.mjs --plate        # the bare acrylic plate only
 *
 * FRAME: millimetres, **Z up, the wheels resting on z = 0, centred on the plate
 * in x/y, +x forward** (the caster end is the nose). A part declares
 * `meshUnits: mm` and its link origin lands at ground level under the plate's
 * centre, so a placed chassis sits on the floor rather than in it, and its
 * `contacts` (see {@link GROUND_CONTACTS}) are the three points that touch.
 * That is the same "underside on z = 0" convention every other library mesh
 * follows — for a vehicle the underside is its wheels.
 *
 * PROVENANCE. No vendor publishes a drawing of this plate. The envelope comes
 * from product listings (Amazon UK/NL DollaTek kits, spare-plate listings, and
 * several hobby-shop pages) which agree to within a few millimetres:
 *
 *   plate            210 × 150 mm  ("15 × 21 cm" spare plate; kits quote
 *                                   21 × 15 / 22 × 14.7 / 21.2 × 15.2 cm)
 *   plate thickness  3 mm          (the laser-cut remixes on Thingiverse are
 *                                   drawn for 3 mm acrylic)
 *   wheel            Ø65 × 26 mm   (every listing; "7 × 7 × 2.6 cm" boxed)
 *   TT motor         70 × 22 × 18.5 mm body, Ø5.4 mm D-shaft, 1:48, ~29 g
 *   ball caster      18 × 25 × 20 mm housing, Ø15 mm steel ball
 *   standoffs        M3 × 30 mm brass ("4 × 30 mm copper columns" in the kits)
 *
 * The vertical stack is where those numbers meet: with the motors hanging on
 * the T-brackets the axle sits 17.5 mm below the plate, which puts the plate's
 * underside 50 mm off the floor — exactly a 30 mm standoff plus the 20 mm
 * caster. Everything not in that table (the hole grid, the notch length, the
 * bracket slots) is REPRESENTATIVE rather than measured: the real plate is
 * peppered with slots and holes whose layout varies between batches. Every
 * number is a named constant below, so a measured correction is a one-line
 * change plus a re-run.
 */
import * as THREE from 'three'
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js'

/** The part folder this model ships in, and the filename `parts.yml` names. */
export const PART_ID = 'robot-car-chassis-2wd'
export const MESH_FILENAME = 'model.stl'

/** The Ø65 yellow wheel, and where its axle sits. */
export const WHEEL = {
  diameterMm: 65,
  widthMm: 26,
  /** The yellow plastic hub inside the tyre, 1 mm proud of each face. */
  hubDiameterMm: 56,
  /** Axle position along the plate: 50 mm forward of the rear edge. */
  axleXMm: -55,
  /** Inner face of the tyre from the centre-line — 2 mm clear of the notch. */
  innerFaceYMm: 47
}

/** The yellow TT gear motor, lying flat-face vertical under the plate. */
export const MOTOR = {
  /** The gearbox block: length along x, thickness along the axle, height in z. */
  gearbox: { lengthMm: 37, thicknessMm: 18.5, heightMm: 22.5 },
  /** The motor can pointing forward out of the gearbox, plus its end cap. */
  can: { diameterMm: 20, lengthMm: 27 },
  cap: { diameterMm: 12, lengthMm: 3 },
  /** Ø5.4 D-shaft, both sides (dual shaft), 9 mm proud of the inner face. */
  shaftDiameterMm: 5.4,
  innerShaftMm: 9,
  /** The shaft sits 11 mm in from the gearbox's rear end. */
  shaftFromRearMm: 11,
  /** Inner (bracket) face from the centre-line. */
  innerFaceYMm: 26,
  /** How far the axle hangs below the plate's underside once bolted to the
   *  T-bracket. This one number sets the whole vertical stack. */
  axleBelowPlateMm: 17.5,
  /** The 20-slot optical encoder disc pressed onto the inner shaft. */
  encoderDisc: { diameterMm: 24, thicknessMm: 1 }
}

/** The acrylic plate. Underside height is derived, not chosen — see MOTOR. */
export const PLATE = {
  lengthMm: 210,
  widthMm: 150,
  thicknessMm: 3,
  rearCornerRadiusMm: 10,
  /** The nose is two big arcs meeting a short flat front edge. */
  noseRadiusMm: 45,
  /** Wheel notches cut into each side, open at the edge. */
  notch: { xFromMm: -90, xToMm: -20, depthMm: 30 },
  get undersideZMm() {
    return WHEEL.diameterMm / 2 + MOTOR.axleBelowPlateMm
  },
  get topZMm() {
    return this.undersideZMm + this.thicknessMm
  }
}

/** The acrylic "T" motor bracket: crossbar on the plate, leg through a slot. */
export const BRACKET = {
  crossbarMm: { x: 22, y: 3, z: 3 },
  legMm: { x: 12, y: 3, z: 26 },
  /** Two per motor, either end of the gearbox. */
  xMm: [-62, -34],
  /** Bracket centre-line from the plate centre — flush against the motor. */
  yMm: MOTOR.innerFaceYMm - 1.5,
  /** The slot in the plate the leg drops through. */
  slotMm: { length: 12.5, width: 3.4 }
}

/** The 4×AA battery holder, screwed to the top between the wheels. */
export const BATTERY_BOX = { lengthMm: 62, widthMm: 58, heightMm: 15, xMm: -55 }

/** The little slide switch behind it. */
export const SWITCH = { lengthMm: 8, widthMm: 13, heightMm: 8, xMm: -98 }

/** The steel-ball caster under the nose, on two brass standoffs. */
export const CASTER = {
  xMm: 80,
  housing: { lengthMm: 25, widthMm: 18, heightMm: 15 },
  ballDiameterMm: 15,
  /** Overall height, ball bottom to housing top ("18 × 25 × 20 mm"). */
  heightMm: 20,
  standoffDiameterMm: 5.5,
  standoffPitchMm: 20,
  get standoffLengthMm() {
    return PLATE.undersideZMm - this.heightMm
  }
}

/** Ø3.2 mm (M3 clearance) round holes through the plate: `{ x, y, d }` mm. */
export const ROUND_HOLES = (() => {
  const d = 3.2
  const holes = []
  // Caster standoffs.
  for (const dx of [-1, 1]) holes.push({ x: CASTER.xMm + (dx * CASTER.standoffPitchMm) / 2, y: 0, d })
  // The forward deck: a 15 mm grid for boards and sensor brackets.
  for (const x of [-10, 5, 20, 35, 50]) for (const y of [-45, -30, -15, 0, 15, 30, 45]) holes.push({ x, y, d })
  // Either side of the battery box, inboard of the wheel notches.
  for (const x of [-80, -60, -40]) for (const y of [-38, 38]) holes.push({ x, y, d })
  return holes
})()

/** Stadium slots: `{ x, y, length, width, axis }` — `axis` is the long direction. */
export const SLOTS = (() => {
  const slots = []
  for (const x of BRACKET.xMm)
    for (const s of [-1, 1])
      slots.push({ x, y: s * BRACKET.yMm, length: BRACKET.slotMm.length, width: BRACKET.slotMm.width, axis: 'x' })
  // A pair at the nose for an ultrasonic / line-sensor bracket.
  for (const s of [-1, 1]) slots.push({ x: 95, y: s * 20, length: 10, width: 3.4, axis: 'y' })
  return slots
})()

/**
 * Where the chassis touches the floor, in the part frame (mm): both tyres and
 * the caster ball. `parts.yml` `contacts` must be this list.
 */
export const GROUND_CONTACTS = [
  [WHEEL.axleXMm, WHEEL.innerFaceYMm + WHEEL.widthMm / 2, 0],
  [WHEEL.axleXMm, -(WHEEL.innerFaceYMm + WHEEL.widthMm / 2), 0],
  [CASTER.xMm, 0, 0]
]

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

/** A stadium-shaped hole path (clockwise, so it reads as a hole). */
function slotPath(slot) {
  const r = slot.width / 2
  const half = slot.length / 2 - r
  const p = new THREE.Path()
  if (slot.axis === 'x') {
    p.moveTo(slot.x - half, slot.y + r)
    p.lineTo(slot.x + half, slot.y + r)
    p.absarc(slot.x + half, slot.y, r, Math.PI / 2, -Math.PI / 2, true)
    p.lineTo(slot.x - half, slot.y - r)
    p.absarc(slot.x - half, slot.y, r, -Math.PI / 2, Math.PI / 2, true)
  } else {
    p.moveTo(slot.x - r, slot.y - half)
    p.lineTo(slot.x - r, slot.y + half)
    p.absarc(slot.x, slot.y + half, r, Math.PI, 0, true)
    p.lineTo(slot.x + r, slot.y - half)
    p.absarc(slot.x, slot.y - half, r, 0, Math.PI, true)
  }
  p.closePath()
  return p
}

/**
 * The plate outline, traced counter-clockwise (x right, y up) with the two wheel
 * notches as part of the perimeter — a notch is open to the edge, so it cannot
 * be a `Shape` hole. Holes and slots are added as holes.
 */
export function plateShape(plate = PLATE) {
  const L = plate.lengthMm / 2
  const W = plate.widthMm / 2
  const r = plate.rearCornerRadiusMm
  const R = plate.noseRadiusMm
  const n = plate.notch
  const s = new THREE.Shape()
  // Right-hand side (y = −W), rear to nose, dipping in around the notch.
  s.moveTo(-L + r, -W)
  s.lineTo(n.xFromMm, -W)
  s.lineTo(n.xFromMm, -W + n.depthMm)
  s.lineTo(n.xToMm, -W + n.depthMm)
  s.lineTo(n.xToMm, -W)
  s.lineTo(L - R, -W)
  // Nose: two big arcs and a flat front edge between them.
  s.absarc(L - R, -W + R, R, -Math.PI / 2, 0, false)
  s.lineTo(L, W - R)
  s.absarc(L - R, W - R, R, 0, Math.PI / 2, false)
  // Left-hand side (y = +W), nose to rear, around the other notch.
  s.lineTo(n.xToMm, W)
  s.lineTo(n.xToMm, W - n.depthMm)
  s.lineTo(n.xFromMm, W - n.depthMm)
  s.lineTo(n.xFromMm, W)
  s.lineTo(-L + r, W)
  // Rear edge with its two small corners.
  s.absarc(-L + r, W - r, r, Math.PI / 2, Math.PI, false)
  s.lineTo(-L, -W + r)
  s.absarc(-L + r, -W + r, r, Math.PI, 1.5 * Math.PI, false)
  s.closePath()

  for (const h of ROUND_HOLES) {
    const p = new THREE.Path()
    p.absarc(h.x, h.y, h.d / 2, 0, Math.PI * 2, true)
    s.holes.push(p)
  }
  for (const slot of SLOTS) s.holes.push(slotPath(slot))
  return s
}

/** The bare acrylic plate, extruded and lifted to its ride height. */
export function plateGeometry(plate = PLATE) {
  const g = new THREE.ExtrudeGeometry(plateShape(plate), {
    depth: plate.thicknessMm,
    bevelEnabled: false,
    curveSegments: 12
  })
  g.translate(0, 0, plate.undersideZMm)
  return g
}

/** One wheel (`side` = +1 left, −1 right): tyre plus hub boss. */
export function wheelGeometries(side) {
  const y = side * (WHEEL.innerFaceYMm + WHEEL.widthMm / 2)
  const z = WHEEL.diameterMm / 2
  return [
    { name: 'tyre', geo: cyl(WHEEL.diameterMm, WHEEL.widthMm, 'y', WHEEL.axleXMm, y, z, 48) },
    { name: 'hub', geo: cyl(WHEEL.hubDiameterMm, WHEEL.widthMm + 2, 'y', WHEEL.axleXMm, y, z, 24) }
  ]
}

/** One TT motor with its shafts and encoder disc, hanging under the plate. */
export function motorGeometries(side) {
  const gb = MOTOR.gearbox
  const z = WHEEL.diameterMm / 2 // the axle height
  const yInner = side * MOTOR.innerFaceYMm
  const yMid = side * (MOTOR.innerFaceYMm + gb.thicknessMm / 2)
  const yOuter = side * (MOTOR.innerFaceYMm + gb.thicknessMm)
  const rearX = WHEEL.axleXMm - MOTOR.shaftFromRearMm
  const canX = rearX + gb.lengthMm + MOTOR.can.lengthMm / 2
  const capX = rearX + gb.lengthMm + MOTOR.can.lengthMm + MOTOR.cap.lengthMm / 2
  // The outer shaft runs from the gearbox face into the wheel hub.
  const outerLen = WHEEL.innerFaceYMm + 10 - (MOTOR.innerFaceYMm + gb.thicknessMm)
  const innerLen = MOTOR.innerShaftMm
  return [
    { name: 'gearbox', geo: box(gb.lengthMm, gb.thicknessMm, gb.heightMm, rearX + gb.lengthMm / 2, yMid, z) },
    { name: 'can', geo: cyl(MOTOR.can.diameterMm, MOTOR.can.lengthMm, 'x', canX, yMid, z, 24) },
    { name: 'cap', geo: cyl(MOTOR.cap.diameterMm, MOTOR.cap.lengthMm, 'x', capX, yMid, z, 16) },
    {
      name: 'shaft-outer',
      geo: cyl(MOTOR.shaftDiameterMm, outerLen, 'y', WHEEL.axleXMm, yOuter + (side * outerLen) / 2, z, 12)
    },
    {
      name: 'shaft-inner',
      geo: cyl(MOTOR.shaftDiameterMm, innerLen, 'y', WHEEL.axleXMm, yInner - (side * innerLen) / 2, z, 12)
    },
    {
      name: 'encoder-disc',
      geo: cyl(
        MOTOR.encoderDisc.diameterMm,
        MOTOR.encoderDisc.thicknessMm,
        'y',
        WHEEL.axleXMm,
        yInner - side * (innerLen - 3),
        z,
        32
      )
    }
  ]
}

/** The two T-brackets holding one motor. */
export function bracketGeometries(side) {
  const out = []
  const y = side * BRACKET.yMm
  const cb = BRACKET.crossbarMm
  const leg = BRACKET.legMm
  for (const x of BRACKET.xMm) {
    out.push({ name: 'bracket-bar', geo: box(cb.x, cb.y, cb.z, x, y, PLATE.topZMm + cb.z / 2) })
    out.push({ name: 'bracket-leg', geo: box(leg.x, leg.y, leg.z, x, y, PLATE.topZMm - leg.z / 2) })
  }
  return out
}

/** Battery holder and its switch, on the plate's top. */
export function topsideGeometries() {
  const bb = BATTERY_BOX
  const sw = SWITCH
  return [
    { name: 'battery-box', geo: box(bb.lengthMm, bb.widthMm, bb.heightMm, bb.xMm, 0, PLATE.topZMm + bb.heightMm / 2) },
    { name: 'switch', geo: box(sw.lengthMm, sw.widthMm, sw.heightMm, sw.xMm, 0, PLATE.topZMm + sw.heightMm / 2) }
  ]
}

/** The caster: two standoffs, the housing, and the ball resting on z = 0. */
export function casterGeometries() {
  const c = CASTER
  const out = []
  for (const dx of [-1, 1]) {
    out.push({
      name: 'standoff',
      geo: cyl(
        c.standoffDiameterMm,
        c.standoffLengthMm,
        'z',
        c.xMm + (dx * c.standoffPitchMm) / 2,
        0,
        PLATE.undersideZMm - c.standoffLengthMm / 2,
        6
      )
    })
  }
  const housingTop = c.heightMm
  out.push({
    name: 'caster-housing',
    geo: box(c.housing.lengthMm, c.housing.widthMm, c.housing.heightMm, c.xMm, 0, housingTop - c.housing.heightMm / 2)
  })
  const ball = new THREE.SphereGeometry(c.ballDiameterMm / 2, 20, 14)
  ball.translate(c.xMm, 0, c.ballDiameterMm / 2)
  out.push({ name: 'caster-ball', geo: ball })
  return out
}

/**
 * Display colours per component, for anyone rendering the group (the catalog
 * image is made this way). An STL carries none of this; it is advisory.
 */
export const COLORS = {
  plate: '#c9e4f2',
  tyre: '#26292d',
  hub: '#f2c318',
  gearbox: '#f2c318',
  can: '#b9bec4',
  cap: '#8d9298',
  'shaft-outer': '#d9dce0',
  'shaft-inner': '#d9dce0',
  'encoder-disc': '#1b1d20',
  'bracket-bar': '#d5e6ef',
  'bracket-leg': '#d5e6ef',
  'battery-box': '#1f2226',
  switch: '#2b2f34',
  standoff: '#c9a227',
  'caster-housing': '#5c6168',
  'caster-ball': '#9ea3a9'
}

/**
 * The whole kit as a three.js Group. Every mesh is named after its component
 * (see {@link COLORS}) so a renderer can colour it; `{ plateOnly: true }` gives
 * just the acrylic, for anyone who wants to build their own kit around it.
 */
export function chassisGroup(opts = {}) {
  const group = new THREE.Group()
  const mat = new THREE.MeshBasicMaterial()
  const add = (name, geo) => {
    const mesh = new THREE.Mesh(geo, mat)
    mesh.name = name
    group.add(mesh)
  }
  add('plate', plateGeometry())
  if (opts.plateOnly) return group
  for (const side of [1, -1]) {
    for (const { name, geo } of wheelGeometries(side)) add(name, geo)
    for (const { name, geo } of motorGeometries(side)) add(name, geo)
    for (const { name, geo } of bracketGeometries(side)) add(name, geo)
  }
  for (const { name, geo } of topsideGeometries()) add(name, geo)
  for (const { name, geo } of casterGeometries()) add(name, geo)
  return group
}

/** Serialise a group to a BINARY STL (compact — ASCII is ~5× the size). */
export function toStl(group) {
  const data = new STLExporter().parse(group, { binary: true })
  return Buffer.from(data.buffer ?? data)
}

// --- CLI -------------------------------------------------------------------
// Node-only imports stay inside main() so the geometry above can also be loaded
// by a browser page (the catalog image is rendered that way) and by the tests
// without the CLI running — or writing an STL — as a side effect of the import.
async function main(args) {
  const { writeFileSync, mkdirSync } = await import('node:fs')
  const { dirname, resolve } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')

  const flag = (name) => {
    const i = args.indexOf(`--${name}`)
    return i >= 0 ? (args[i + 1] ?? '') : undefined
  }
  const plateOnly = args.includes('--plate')
  const out = resolve(
    repo,
    flag('out') ?? `examples/parts/snakie-standard/${PART_ID}/${plateOnly ? 'plate.stl' : MESH_FILENAME}`
  )
  const stl = toStl(chassisGroup({ plateOnly }))
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, stl)
  console.log(
    `${out.replace(`${repo}/`, '')} — ${(stl.length - 84) / 50} triangles, ${(stl.length / 1024).toFixed(1)} KB` +
      (plateOnly ? ' (plate only)' : '')
  )
}

if (typeof process !== 'undefined' && process.argv?.[1]) {
  const { fileURLToPath } = await import('node:url')
  const { resolve } = await import('node:path')
  if (resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main(process.argv.slice(2))
}
