/**
 * The FunduMoto L298P motor shield (Keyes_L298P), for the kevsrobots catalog.
 *
 * Nobody publishes CAD or a licensed top view for this board, so both are drawn
 * here from one layout: positions measured off a flat top-down photo (laskakit.cz,
 * reference only, not shipped) at ~9.85 px/mm, with the stacking headers snapped
 * to the UNO's own grid.
 *
 *   node scripts/fundumoto-shield.mjs           # writes model.stl + image.svg
 *
 * `image.svg` is rendered to the part's `image.png` (395 × 512, the UNO
 * parts) with any SVG renderer; the pins in parts.yml come from `PINS` below.
 *
 * Frame: landscape, mm, origin at the bottom-left of the PCB with the motor
 * terminals on the left (over the UNO's USB and barrel jack), X along the 70 mm
 * edge, Y up from the power/analog header edge. That is the UNO board file's own
 * frame shifted by {@link UNO_OFFSET}, so the part's portrait frame matches the
 * UNO parts': nx = Y / 54, ny = X / 70.
 */
import * as THREE from 'three'
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js'

export const SHIELD = { lengthMm: 70, widthMm: 54, thicknessMm: 1.6 }
/** Where the UNO's own (0, 0) sits on the shield: the UNO is centred under it. */
export const UNO_OFFSET = [(70 - 68.58) / 2, (54 - 53.34) / 2]
const PITCH = 2.54

/** A point on the UNO's grid, in the shield frame. */
const uno = (x, y) => [x + UNO_OFFSET[0], y + UNO_OFFSET[1]]

/** Normalised portrait position of a shield-frame point (what parts.yml stores). */
export const norm = (X, Y) => ({ x: +(Y / SHIELD.widthMm).toFixed(4), y: +(X / SHIELD.lengthMm).toFixed(4) })

/** Stacking headers: the UNO's four rows, re-presented on top of the shield. */
export const STACK_HEADERS = [
  { x0: 18.796, count: 10, y: 50.8 },
  { x0: 45.72, count: 8, y: 50.8 },
  { x0: 27.94, count: 8, y: 2.54 },
  { x0: 50.8, count: 6, y: 2.54 }
].map((h) => ({ ...h, at: uno(h.x0, h.y) }))

/**
 * The shield's own connectors. Each pin: [name, type, label, X, Y, arduino].
 * `arduino` is the UNO pin it is wired to (a rail in parts.yml); names are unique
 * because rails join pins by name.
 */
const D = (n) => uno(45.72 + (7 - n) * PITCH, 50.8)[0] // X of digital pin n (n ≤ 7)
export const CONNECTORS = [
  {
    id: 'motor-power', title: 'Motor power', kind: 'terminal', pitch: 5.0, axis: 'x',
    pins: [
      ['VMS', 'pwr', '+', 4.3, 49.9, null],
      ['VMS_GND', 'gnd', '−', 9.3, 49.9, 'GND']
    ]
  },
  {
    id: 'motors', title: 'Motor outputs', kind: 'terminal', pitch: 5.0, axis: 'y',
    pins: [
      ['MOTOR_B1', 'other', 'B', 4.8, 30.2, null],
      ['MOTOR_B2', 'other', 'B', 4.8, 25.2, null],
      ['MOTOR_A1', 'other', 'A', 4.8, 20.2, null],
      ['MOTOR_A2', 'other', 'A', 4.8, 15.2, null]
    ]
  },
  {
    id: 'ma-mb', title: 'MA / MB', kind: 'female', axis: 'y',
    pins: [
      ['MB_1', 'other', 'MB', 14.9, 25.6, null],
      ['MB_2', 'other', 'MB', 14.9, 23.06, null],
      ['MA_1', 'other', 'MA', 14.9, 20.52, null],
      ['MA_2', 'other', 'MA', 14.9, 17.98, null]
    ]
  },
  {
    id: 'servo', title: 'Servo', kind: 'male', color: '#f2f2ee', axis: 'x',
    pins: [
      ['SERVO_GND', 'gnd', 'G', 18.2, 45.0, 'GND'],
      ['SERVO_5V', 'pwr', '+5', 20.74, 45.0, null],
      ['SERVO', 'io', '9', 23.28, 45.0, 'D9']
    ]
  },
  {
    id: 'ping', title: 'Ping (ultrasonic)', kind: 'male', color: '#f4c430', axis: 'x',
    pins: [
      ['PING_5V', 'pwr', '+', 39.5, 41.8, '5V'],
      ['PING_ECHO', 'io', 'R', 42.04, 41.8, 'D8'],
      ['PING_TRIG', 'io', 'T', 44.58, 41.8, 'D7'],
      ['PING_GND', 'gnd', 'G', 47.12, 41.8, 'GND']
    ]
  },
  {
    id: 'rgb', title: 'RGB LED', kind: 'male', color: '#2f6fd6', axis: 'x',
    pins: [
      ['RGB_5V', 'pwr', '5V', D(7), 46.1, '5V'],
      ['RGB_B', 'io', 'B', D(6), 46.1, 'D6'],
      ['RGB_G', 'io', 'G', D(5), 46.1, 'D5'],
      ['RGB_GND', 'gnd', '−', D(4), 46.1, 'GND'],
      ['RGB_R', 'io', 'R', D(3), 46.1, 'D3']
    ]
  },
  {
    id: 'bt2', title: 'Bluetooth (BT2)', kind: 'female', axis: 'y',
    pins: [
      ['BT_RX', 'io', 'R', 56.1, 39.4, 'D1'],
      ['BT_TX', 'io', 'T', 56.1, 36.86, 'D0'],
      ['BT_GND', 'gnd', '−', 56.1, 34.32, 'GND'],
      ['BT_3V3', 'pwr', '+', 56.1, 31.78, '3V3']
    ]
  },
  {
    id: 'pin2', title: 'Digital I/O (pin 2)', kind: 'male', color: '#2f6fd6', axis: 'x',
    pins: [
      ['IO2_GND', 'gnd', 'G', 52.45, 21.2, 'GND'],
      ['IO2_5V', 'pwr', '+', 54.99, 21.2, '5V'],
      ['IO2', 'io', 'S', 57.53, 21.2, 'D2']
    ]
  },
  // The 3 × 6 sensor block: a ground, 5 V and signal pin for each of A0–A5,
  // one column per analog pin (lined up with the analog header below it).
  ...['GND', '5V', 'S'].map((row, r) => ({
    id: `sensor-${row.toLowerCase()}`, title: `Sensor ${row === 'S' ? 'signals' : row}`, kind: 'male',
    color: ['#1d1d1d', '#d8322e', '#f2f2ee'][r], axis: 'x',
    pins: [0, 1, 2, 3, 4, 5].map((i) => [
      row === 'S' ? `SENSOR_A${i}` : `SENSOR${i}_${row}`,
      row === 'S' ? 'io' : row === 'GND' ? 'gnd' : 'pwr',
      row === 'S' ? `A${i}` : row === 'GND' ? 'G' : '+',
      uno(50.8 + i * PITCH, 0)[0],
      [16.1, 13.5, 10.5][r],
      row === 'S' ? `A${i}` : row
    ])
  }))
]

/** Everything the photo shows that isn't a wireable pin. [X, Y] centres, sizes in mm. */
export const BODY = {
  holes: [uno(13.97, 2.54), uno(15.24, 50.8), uno(66.04, 7.62), uno(66.04, 35.56)],
  holeDiameterMm: 3.2,
  outline: [
    [0, 0], [67.4, 0], [67.4, 2.9], [70, 5.5], [70, 38.2], [67.4, 40.8], [67.4, 52.2], [65.6, 54], [0, 54]
  ],
  l298p: { at: [40.8, 24.3], body: [16, 11, 3.5], leads: 10 },
  buzzer: { at: [30.6, 42.5], d: 12, h: 9.5 },
  cap: { at: [35.7, 11.2], d: 6.3, h: 7 },
  reset: { at: [23.0, 2.9], body: [6, 3.5, 2.5] },
  opt: { at: [42.0, 10.8] },
  diodes: [[21.6, 34.1], [25.8, 34.1], [21.6, 26.8], [25.8, 26.8], [21.6, 19.1], [25.8, 19.1], [21.6, 11.5], [25.8, 11.5]],
  /** The two 74HC1G04 inverters: [X, Y, silk offset in Y]. */
  inverters: [[39.0, 36.8, -2.2], [46.1, 11.2, 2.6]],
  /** Motor indicator LEDs, yellow/green per channel. */
  leds: [[5.0, 42.0, '#f4d03f'], [5.0, 37.0, '#59c96b'], [5.0, 10.0, '#59c96b'], [5.0, 5.5, '#f4d03f']],
  bluetooth: { at: [64.5, 27.5], cols: 2, rows: 6, pitch: 2.0 }
}

/** Every named pin, flattened: { name, type, label, X, Y, arduino, connector }. */
export const PINS = CONNECTORS.flatMap((c) =>
  c.pins.map(([name, type, label, X, Y, arduino]) => ({ name, type, label, X, Y, arduino, connector: c.id }))
)

// --- 3D model ----------------------------------------------------------------

/** Shield frame → portrait mesh frame, centred on the PCB (as the UNO meshes). */
const toPortrait = (X, Y) => [Y - SHIELD.widthMm / 2, -(X - SHIELD.lengthMm / 2)]

function box(sx, sy, sz, cx, cy, cz) {
  const g = new THREE.BoxGeometry(sx, sy, sz)
  g.translate(cx, cy, cz)
  return g
}
/** A body given landscape (w along X, l along Y), standing on z0. */
function bodyAt(w, l, h, X, Y, z0) {
  const [px, py] = toPortrait(X, Y)
  return box(l, w, h, px, py, z0 + h / 2)
}
function cylAt(d, h, X, Y, z0) {
  const g = new THREE.CylinderGeometry(d / 2, d / 2, h, 32)
  g.rotateX(Math.PI / 2)
  const [px, py] = toPortrait(X, Y)
  g.translate(px, py, z0 + h / 2)
  return g
}

/** How far the stacking-header legs reach below the PCB (into the UNO's headers). */
export const LEG_MM = 9

export function shieldGeometries() {
  const t = SHIELD.thicknessMm
  const z = LEG_MM // PCB underside: the legs hang below, lowest point z = 0
  const top = z + t
  const s = new THREE.Shape()
  BODY.outline.forEach(([X, Y], i) => (i ? s.lineTo(...toPortrait(X, Y)) : s.moveTo(...toPortrait(X, Y))))
  s.closePath()
  for (const [X, Y] of BODY.holes) {
    const p = new THREE.Path()
    p.absarc(...toPortrait(X, Y), BODY.holeDiameterMm / 2, 0, Math.PI * 2, true)
    s.holes.push(p)
  }
  const pcb = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false, curveSegments: 16 })
  pcb.translate(0, 0, z)
  const out = [{ name: 'pcb', geo: pcb }]
  for (const h of STACK_HEADERS) {
    const len = h.count * PITCH
    out.push({ name: 'stacking-header', geo: bodyAt(len, PITCH, 8.5, h.at[0] - PITCH / 2 + len / 2, h.at[1], top) })
    for (let i = 0; i < h.count; i++)
      out.push({ name: 'stacking-leg', geo: bodyAt(0.64, 0.64, LEG_MM, h.at[0] + i * PITCH, h.at[1], 0) })
  }
  for (const c of CONNECTORS) {
    const xs = c.pins.map((p) => p[3])
    const ys = c.pins.map((p) => p[4])
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2
    const n = c.pins.length
    if (c.kind === 'terminal') {
      const pitch = c.pitch
      const [w, l] = c.axis === 'x' ? [n * pitch, 8] : [8, n * pitch]
      out.push({ name: `${c.id}-terminal`, geo: bodyAt(w, l, 10, cx, cy, top) })
      for (const p of c.pins) out.push({ name: `${c.id}-screw`, geo: cylAt(3.2, 0.6, p[3], p[4], top + 10) })
    } else {
      const [w, l] = c.axis === 'x' ? [n * PITCH, PITCH] : [PITCH, n * PITCH]
      const h = c.kind === 'female' ? 8.5 : 2.5
      out.push({ name: `${c.id}-header`, geo: bodyAt(w, l, h, cx, cy, top) })
      if (c.kind === 'male')
        for (const p of c.pins) out.push({ name: `${c.id}-pin`, geo: bodyAt(0.64, 0.64, 8.5, p[3], p[4], top) })
    }
  }
  const b = BODY
  out.push({ name: 'l298p', geo: bodyAt(...b.l298p.body, ...b.l298p.at, top) })
  for (const side of [-1, 1])
    out.push({
      name: 'l298p-leads',
      geo: bodyAt(b.l298p.body[0] - 2, 1.6, 0.6, b.l298p.at[0], b.l298p.at[1] + side * (b.l298p.body[1] / 2 + 0.8), top)
    })
  out.push({ name: 'buzzer', geo: cylAt(b.buzzer.d, b.buzzer.h, ...b.buzzer.at, top) })
  out.push({ name: 'capacitor', geo: cylAt(b.cap.d, b.cap.h, ...b.cap.at, top) })
  out.push({ name: 'reset', geo: bodyAt(...b.reset.body, ...b.reset.at, top) })
  out.push({ name: 'opt-jumper', geo: bodyAt(2.5, 5, 6, ...b.opt.at, top) })
  for (const [X, Y] of b.diodes) out.push({ name: 'diode', geo: bodyAt(2.8, 4.4, 2.2, X, Y, top) })
  for (const [X, Y] of b.inverters) out.push({ name: 'inverter', geo: bodyAt(2.9, 1.6, 1.1, X, Y, top) })
  for (const [X, Y] of b.leds) out.push({ name: 'led', geo: bodyAt(3.2, 1.6, 1.1, X, Y, top) })
  const bt = b.bluetooth
  out.push({ name: 'bluetooth-header', geo: bodyAt(bt.cols * bt.pitch, bt.rows * bt.pitch, 2, ...bt.at, top) })
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

export function toStl(group) {
  const data = new STLExporter().parse(group, { binary: true })
  return Buffer.from(data.buffer ?? data)
}

// --- Top view (SVG) ----------------------------------------------------------

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')

/**
 * The top view, drawn landscape (sx = X, sy = 54 − Y) inside a group turned to
 * the part's portrait frame. 54 × 70 mm, scaled to `heightPx`.
 */
export function shieldSvg(heightPx = 512) {
  const W = SHIELD.widthMm
  const L = SHIELD.lengthMm
  const sy = (Y) => W - Y
  const o = []
  const silk = '#f4f7fb'
  const text = (X, Y, s, size = 1.6, extra = '') =>
    o.push(`<text x="${X}" y="${sy(Y)}" font-size="${size}" fill="${silk}" text-anchor="middle" dominant-baseline="central" font-family="Arial, Helvetica, sans-serif" font-weight="700" ${extra}>${esc(s)}</text>`)
  const rect = (X, Y, w, h, fill, extra = '') =>
    o.push(`<rect x="${X - w / 2}" y="${sy(Y) - h / 2}" width="${w}" height="${h}" fill="${fill}" ${extra}/>`)
  const circle = (X, Y, r, fill, extra = '') => o.push(`<circle cx="${X}" cy="${sy(Y)}" r="${r}" fill="${fill}" ${extra}/>`)

  // Board, with the copper-pour tint and a thin edge.
  const pts = BODY.outline.map(([X, Y]) => `${X},${sy(Y)}`).join(' ')
  o.push(`<defs><linearGradient id="pcb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2a74c4"/><stop offset="1" stop-color="#14549e"/></linearGradient></defs>`)
  o.push(`<polygon points="${pts}" fill="url(#pcb)" stroke="#0d3f78" stroke-width="0.35"/>`)
  for (const [X, Y] of BODY.holes) {
    circle(X, Y, 2.3, '#c9ccd1')
    circle(X, Y, BODY.holeDiameterMm / 2, '#f7f7f5')
  }

  // Stacking headers (black, a socket per pin).
  for (const h of STACK_HEADERS) {
    const len = h.count * PITCH
    rect(h.at[0] - PITCH / 2 + len / 2, h.at[1], len, PITCH, '#1b1b1b', 'rx="0.3"')
    for (let i = 0; i < h.count; i++) rect(h.at[0] + i * PITCH, h.at[1], 1.0, 1.0, '#050505')
  }
  // Silk for the headers, as on the board.
  ;['13', '12', '11', '10', '9', '8'].forEach((s, i) => text(uno(29.0 + i * PITCH, 0)[0], 48.3, s, 1.5))
  ;['7', '6', '5', '4', '3', '2', '1', '0'].forEach((s, i) => text(uno(45.72 + i * PITCH, 0)[0], 48.3, s, 1.5))
  text(40.6, 45.6, 'DIGITAL', 1.3)
  ;['RST', '3V3', '5V', 'Gnd', 'Vin'].forEach((s, i) => text(uno(32.7 + i * 2.6, 0)[0], 5.5, s, 1.2))
  ;['0', '1', '2', '3', '4', '5'].forEach((s, i) => text(uno(50.8 + i * PITCH, 0)[0], 5.5, s, 1.4))
  text(57.6, 7.6, 'ANALOG  IN', 1.4)
  text(29.0, 6.0, 'POWER', 1.2, `transform="rotate(-90 29 ${sy(6)})"`)

  // L298P (PowerSO-20) with its leads.
  const ic = BODY.l298p
  for (let i = 0; i < ic.leads; i++) {
    const X = ic.at[0] - ((ic.leads - 1) / 2) * 1.27 + i * 1.27
    rect(X, ic.at[1] + ic.body[1] / 2 + 0.9, 0.6, 1.8, '#c8ccd2')
    rect(X, ic.at[1] - ic.body[1] / 2 - 0.9, 0.6, 1.8, '#c8ccd2')
  }
  rect(...ic.at, ic.body[0], ic.body[1], '#202022', 'rx="0.4"')
  text(ic.at[0], ic.at[1] + 1.8, 'ST  L298P', 1.6, 'fill="#9a9ca3"')
  text(ic.at[0], ic.at[1] - 2.2, '99238  VW', 1.2, 'fill="#7d8088"')
  text(31.5, 24.5, 'L298P', 2.2, `transform="rotate(-90 31.5 ${sy(24.5)})"`)

  // Diodes (SMA, "M7"), inverters, LEDs.
  for (const [X, Y] of BODY.diodes) {
    rect(X, Y, 3.4, 5.2, 'none', `stroke="${silk}" stroke-width="0.25"`)
    rect(X, Y, 2.6, 4.2, '#2a2a2c')
    rect(X, Y + 1.5, 2.6, 0.6, '#9a9ca3')
    text(X, Y - 0.4, 'M7', 0.9, `fill="#9a9ca3" transform="rotate(-90 ${X} ${sy(Y - 0.4)})"`)
  }
  for (const [X, Y, dy] of BODY.inverters) {
    rect(X, Y, 2.9, 1.6, '#2a2a2c')
    text(X, Y + dy, '74HC1G04', 1.0)
  }
  for (const [X, Y, c] of BODY.leds) {
    rect(X, Y, 4.6, 2.2, 'none', `stroke="${silk}" stroke-width="0.25" rx="1"`)
    rect(X, Y, 3.0, 1.4, c, 'rx="0.3"')
  }
  text(5.0, 39.6, 'yellow  green', 1.0)
  text(5.0, 7.8, 'green  yellow', 1.0)

  // Buzzer, electrolytic, reset, OPT jumper, Bluetooth 2 mm header.
  const bz = BODY.buzzer
  circle(...bz.at, bz.d / 2, '#151515')
  circle(...bz.at, bz.d / 2 - 0.8, '#262626')
  circle(...bz.at, 1.2, '#050505')
  text(bz.at[0], bz.at[1] - 7.5, 'BUZZ', 1.3)
  const cp = BODY.cap
  circle(...cp.at, cp.d / 2, '#c7cacf')
  circle(...cp.at, cp.d / 2 - 0.5, '#a9adb3')
  text(cp.at[0], cp.at[1] + 0.9, '100', 1.2, 'fill="#222"')
  text(cp.at[0], cp.at[1] - 0.9, '25V', 1.1, 'fill="#222"')
  const rs = BODY.reset
  rect(...rs.at, 7.4, 3.6, '#c9ccd1', 'rx="0.6"')
  rect(...rs.at, 3.2, 1.8, '#2a2a2a', 'rx="0.4"')
  rect(...BODY.opt.at, 2.6, 5.0, '#2f6fd6', 'rx="0.3"')
  rect(...BODY.opt.at, 1.4, 3.6, '#16161a')
  text(BODY.opt.at[0], BODY.opt.at[1] - 3.6, 'OPT', 1.3)
  const bt = BODY.bluetooth
  rect(...bt.at, bt.cols * bt.pitch + 0.6, bt.rows * bt.pitch + 0.6, '#151515', `stroke="${silk}" stroke-width="0.25"`)
  for (let c = 0; c < bt.cols; c++)
    for (let r = 0; r < bt.rows; r++)
      rect(bt.at[0] + (c - 0.5) * bt.pitch, bt.at[1] + (r - 2.5) * bt.pitch, 0.6, 0.6, '#d9b85a')
  text(68.0, bt.at[1], 'bluetooth', 1.5, `transform="rotate(-90 68 ${sy(bt.at[1])})"`)

  // The connectors.
  for (const c of CONNECTORS) {
    const xs = c.pins.map((p) => p[3])
    const ys = c.pins.map((p) => p[4])
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2
    const n = c.pins.length
    if (c.kind === 'terminal') {
      const [w, h] = c.axis === 'x' ? [n * c.pitch, 7.6] : [7.6, n * c.pitch]
      rect(cx, cy, w, h, '#2b7de0', 'rx="0.4" stroke="#1c5aa8" stroke-width="0.3"')
      for (const p of c.pins) {
        circle(p[3], p[4], 1.7, '#c4c8ce', 'stroke="#8d939b" stroke-width="0.3"')
        const [X, Y] = [p[3], p[4]]
        o.push(`<line x1="${X - 1.1}" y1="${sy(Y) - 1.1}" x2="${X + 1.1}" y2="${sy(Y) + 1.1}" stroke="#7a8089" stroke-width="0.45"/>`)
      }
    } else {
      const [w, h] = c.axis === 'x' ? [n * PITCH, PITCH] : [PITCH, n * PITCH]
      const fill = c.kind === 'female' ? '#1b1b1b' : c.color
      rect(cx, cy, w, h, fill, 'rx="0.3" stroke="rgba(0,0,0,0.35)" stroke-width="0.15"')
      for (const p of c.pins)
        if (c.kind === 'female') rect(p[3], p[4], 1.0, 1.0, '#050505')
        else rect(p[3], p[4], 0.7, 0.7, '#d9b85a')
    }
  }
  // Connector silk.
  text(4.3, 44.7, '+', 1.6)
  text(9.3, 44.7, '−', 1.6)
  text(20.74, 47.6, 'SERVO', 1.4)
  ;['G', '+5', '9'].forEach((s, i) => text(18.2 + i * 2.54, 43.0, s, 1.1))
  ;['+', 'R', 'T', 'G'].forEach((s, i) => text(39.5 + i * 2.54, 43.8, s, 1.3))
  text(43.3, 39.4, 'Ping', 1.4)
  ;['B', 'G', '−', 'R'].forEach((s, i) => text(D(6) + i * PITCH, 43.8, s, 1.3))
  ;['R', 'T', '−', '+'].forEach((s, i) => text(58.3, 39.4 - i * 2.54, s, 1.2))
  text(60.2, 35.6, 'BT2', 1.3, `transform="rotate(-90 60.2 ${sy(35.6)})"`)
  text(55.0, 23.7, 'PIN 2 I/O', 1.3)
  ;['G', '+', 'S'].forEach((s, i) => text(52.45 + i * 2.54, 19.0, s, 1.2))
  text(67.6, 16.1, 'GND', 1.1)
  text(67.6, 13.5, '+5', 1.1)
  text(10.6, 27.7, 'MOTORB', 1.4, `transform="rotate(-90 10.6 ${sy(27.7)})"`)
  text(10.6, 17.7, 'MOTORA', 1.4, `transform="rotate(-90 10.6 ${sy(17.7)})"`)
  text(17.6, 21.8, 'MA  MB', 1.4, `transform="rotate(-90 17.6 ${sy(21.8)})"`)
  text(21.0, 6.3, 'Keyes_L298P', 1.5)
  text(6.0, 1.6, 'FunduMoto', 1.6)

  const wPx = Math.round((heightPx * W) / L)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${wPx}" height="${heightPx}" viewBox="0 0 ${W} ${L}">
<g transform="translate(${W} 0) rotate(90)">
${o.join('\n')}
</g>
</svg>
`
}

async function main() {
  const { writeFileSync } = await import('node:fs')
  const { dirname, resolve } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const dir = resolve(repo, 'examples/parts/kevsrobots-catalog/fundumoto-motor-shield')
  const stl = toStl(shieldGroup())
  writeFileSync(resolve(dir, 'model.stl'), stl)
  console.log(`model.stl — ${(stl.length - 84) / 50} triangles, ${(stl.length / 1024).toFixed(1)} KB`)
  writeFileSync(resolve(dir, 'image.svg'), shieldSvg())
  console.log('image.svg — render it to image.png (395 × 512)')
}

if (typeof process !== 'undefined' && process.argv?.[1]) {
  const { fileURLToPath } = await import('node:url')
  const { resolve } = await import('node:path')
  if (resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
}
