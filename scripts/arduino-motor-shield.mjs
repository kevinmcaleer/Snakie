/**
 * The Arduino Motor Shield Rev3 (A000079), for the kevsrobots catalog.
 *
 * Arduino publishes the board as Eagle files (binary Eagle 5, not the XML the
 * UNO R3's came in), a schematic and a vector top view, but no 3D model. So the
 * part's picture is Arduino's own top view (`image.svg` on the docs page, turned
 * to portrait), and this script makes the 3D model from positions measured off
 * that drawing: same outline and holes as the UNO R3, the stacking headers, the
 * 6-way screw terminal, the L298P, the TinkerKit connectors and the larger parts
 * as blocks.
 *
 *   node scripts/arduino-motor-shield.mjs      # writes model.stl
 *
 * Arduino's drawing is landscape with the screw terminal on the RIGHT (the UNO
 * board file has the USB end on the left), 194.4 × 151.2 pt = 68.58 × 53.34 mm.
 * Positions below are in its pixels at 4 px/pt; {@link brd} turns them into the
 * UNO board frame the other UNO models use.
 */
import * as THREE from 'three'
import { UNO_R3, toPortrait, toStl, unoR3Shape } from './arduino-uno-meshes.mjs'

const PX_PER_MM = (4 * 72) / 25.4
const DRAWING_W = 777.6
/** Drawing px → the UNO board frame (mm, USB end at x = 0, power header at y = 0). */
export const brd = (px, py) => [(DRAWING_W - px) / PX_PER_MM, py / PX_PER_MM]
/** Drawing px → the part's normalised portrait position. */
export const norm = (px, py) => ({ x: +(py / 604.8).toFixed(4), y: +((DRAWING_W - px) / DRAWING_W).toFixed(4) })

/**
 * The shield's own connectors (drawing px). Each pin: [name, type, label, px, py, UNO pin].
 * From the schematic: motor A = OUT1/OUT2, B = OUT3/OUT4; the terminal's VIN is
 * the UNO's VIN while the VIN-CONNECT jumper is closed (as shipped). TinkerKit
 * connectors: GND, +5V and the signal in the middle.
 */
export const CONNECTORS = [
  {
    id: 'power-motors', kind: 'terminal',
    pins: [
      ['MOTOR_GND', 'gnd', 'GND', 705, 42, 'GND'],
      ['MOTOR_VIN', 'pwr', 'Vin', 705, 86, 'VIN'],
      ['MOTOR_A+', 'other', 'A+', 705, 129, null],
      ['MOTOR_A-', 'other', 'A−', 705, 173, null],
      ['MOTOR_B+', 'other', 'B+', 705, 217, null],
      ['MOTOR_B-', 'other', 'B−', 705, 261, null]
    ]
  },
  ...[
    ['IN3', 118.5, 'A3', 'white'],
    ['IN2', 204.5, 'A2', 'white'],
    ['OUT5', 290, 'D5', 'orange'],
    ['OUT6', 375, 'D6', 'orange']
  ].map(([id, px, uno]) => ({
    id: id.toLowerCase(), kind: 'tinkerkit',
    pins: [
      [`${id}_GND`, 'gnd', 'GND', px, 404, 'GND'],
      [id, 'io', id, px, 432.5, uno],
      [`${id}_5V`, 'pwr', '5V', px, 460, '5V']
    ]
  })),
  ...[
    ['TWI_A', 462.5],
    ['TWI_B', 547.5]
  ].map(([id, px]) => ({
    id: id.toLowerCase(), kind: 'tinkerkit',
    pins: [
      [`${id}_GND`, 'gnd', 'GND', px, 390, 'GND'],
      [`${id}_SDA`, 'io', 'SDA', px, 418, 'SDA'],
      [`${id}_SCL`, 'io', 'SCL', px, 445.5, 'SCL'],
      [`${id}_5V`, 'pwr', '5V', px, 473.5, '5V']
    ]
  }))
]

export const PINS = CONNECTORS.flatMap((c) =>
  c.pins.map(([name, type, label, px, py, uno]) => ({ name, type, label, px, py, uno, connector: c.id }))
)

/** Bodies as drawing-px boxes [x0, y0, x1, y1, height mm]. */
const BODIES = {
  terminal: [662, 12, 748, 290, 10],
  l298p: [260, 163, 432, 297, 3.5],
  diodes: [130, 187, 245, 302].flatMap((y) => [452, 538].map((x) => [x, y, x + 45, y + 30, 2.2])),
  resistors: [453, 490, 530, 567].map((x) => [x, 70, x + 26, 100, 1.5]),
  leds: [130, 173, 216, 259].map((y) => [625, y - 6, 642, y + 6, 0.8]),
  ics: [
    [108, 293, 208, 337, 1.7],
    [140, 197, 176, 233, 1.1]
  ],
  reset: [672, 535, 742, 597, 3.5],
  connectors: [
    [97, 390, 150, 474, 6],
    [183, 390, 236, 474, 6],
    [270, 390, 322, 474, 6],
    [355, 390, 407, 474, 6],
    [441, 376, 493, 488, 6],
    [527, 376, 579, 488, 6]
  ]
}

/** How far the stacking-header legs reach below the PCB (into the UNO's headers). */
export const LEG_MM = 9

function box(sx, sy, sz, cx, cy, cz) {
  const g = new THREE.BoxGeometry(sx, sy, sz)
  g.translate(cx, cy, cz)
  return g
}
/** A drawing-px box standing on z0, in the portrait mesh frame. */
function pxBox([x0, y0, x1, y1, h], z0) {
  const [ax, ay] = toPortrait(...brd(x0, y0))
  const [bx, by] = toPortrait(...brd(x1, y1))
  return box(Math.abs(bx - ax), Math.abs(by - ay), h, (ax + bx) / 2, (ay + by) / 2, z0 + h / 2)
}
function cyl(d, h, X, Y, z0) {
  const g = new THREE.CylinderGeometry(d / 2, d / 2, h, 24)
  g.rotateX(Math.PI / 2)
  const [px, py] = toPortrait(X, Y)
  g.translate(px, py, z0 + h / 2)
  return g
}

export function shieldGeometries() {
  const t = UNO_R3.thicknessMm
  const top = LEG_MM + t
  const pcb = new THREE.ExtrudeGeometry(unoR3Shape(), { depth: t, bevelEnabled: false, curveSegments: 16 })
  pcb.translate(0, 0, LEG_MM)
  const out = [{ name: 'pcb', geo: pcb }]
  const pitch = 2.54
  for (const h of UNO_R3.headers) {
    const len = h.count * pitch
    const [px, py] = toPortrait(h.x0 - pitch / 2 + len / 2, h.y)
    out.push({ name: `stacking-${h.name}`, geo: box(pitch, len, 8.5, px, py, top + 4.25) })
    for (let i = 0; i < h.count; i++) {
      const [lx, ly] = toPortrait(h.x0 + i * pitch, h.y)
      out.push({ name: 'stacking-leg', geo: box(0.64, 0.64, LEG_MM, lx, ly, LEG_MM / 2) })
    }
  }
  const b = BODIES
  out.push({ name: 'screw-terminal', geo: pxBox(b.terminal, top) })
  for (const p of CONNECTORS[0].pins) out.push({ name: 'screw', geo: cyl(3.2, 0.6, ...brd(p[3], p[4]), top + b.terminal[4]) })
  out.push({ name: 'l298p', geo: pxBox(b.l298p, top) })
  for (const d of b.diodes) out.push({ name: 'diode', geo: pxBox(d, top) })
  for (const r of b.resistors) out.push({ name: 'resistor', geo: pxBox(r, top) })
  for (const l of b.leds) out.push({ name: 'led', geo: pxBox(l, top) })
  for (const ic of b.ics) out.push({ name: 'ic', geo: pxBox(ic, top) })
  out.push({ name: 'reset', geo: pxBox(b.reset, top) })
  for (const c of b.connectors) out.push({ name: 'tinkerkit', geo: pxBox(c, top) })
  for (const p of PINS.filter((q) => q.connector !== 'power-motors'))
    out.push({ name: 'tinkerkit-pin', geo: cyl(0.64, 5, ...brd(p.px, p.py), top) })
  return out
}

export function shieldGroup() {
  const group = new THREE.Group()
  const mat = new THREE.MeshBasicMaterial()
  for (const { name, geo } of shieldGeometries()) {
    const mesh = new THREE.Mesh(geo, mat)
    mesh.name = name
    group.add(mesh)
  }
  return group
}

async function main() {
  const { writeFileSync } = await import('node:fs')
  const { dirname, resolve } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const out = resolve(repo, 'examples/parts/kevsrobots-catalog/arduino-motor-shield-rev3/model.stl')
  const stl = toStl(shieldGroup())
  writeFileSync(out, stl)
  console.log(`model.stl — ${(stl.length - 84) / 50} triangles, ${(stl.length / 1024).toFixed(1)} KB`)
}

if (typeof process !== 'undefined' && process.argv?.[1]) {
  const { fileURLToPath } = await import('node:url')
  const { resolve } = await import('node:path')
  if (resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
}
