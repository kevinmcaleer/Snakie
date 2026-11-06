/**
 * ARDUINO UNO PART MESHES — the UNO R3, UNO R4 Minima, UNO R4 WiFi and UNO Q.
 *
 * Arduino publishes an official STEP model for three of the four boards, so
 * those ship Arduino's own geometry, converted to STL here. The UNO R3 has no
 * published model (its CAD archive holds only the Eagle board), so it is
 * generated with three.js from named dimensions read off that board file
 * (`UNO-TH_Rev3e.brd`), the same way `robot-kit-meshes.mjs` builds the Pico.
 *
 *   node scripts/arduino-uno-meshes.mjs --r3
 *       → examples/parts/snakie-standard/arduino-uno-r3/model.stl
 *   node scripts/arduino-uno-meshes.mjs --step arduino-uno-r4-wifi path/to/UNO_R4_WIFI.step
 *       → examples/parts/snakie-standard/arduino-uno-r4-wifi/model.stl
 *
 * `--step` needs the OpenCascade reader, which is not a dependency of the app:
 * `npm i --no-save occt-import-js` first. The STEP files come from each board's
 * docs.arduino.cc page (CAD files / 3D model downloads), CC BY-SA 4.0:
 *   R4 Minima — ABX00080-cad-files.zip → Additional files/PCB(ABX00080).step
 *   R4 WiFi   — ABX00087-step.zip      → UNO_R4_WIFI.step
 *   UNO Q     — ABX00162-step.zip      → UNO Q simplified.stp (Arduino's only model)
 *
 * FRAME (every library mesh): millimetres, Z up, the lowest point on z = 0,
 * centred on the PCB in x/y, with x/y matching the part's 2-D footprint. The
 * parts are authored PORTRAIT — USB/power end at the top (+y), the digital
 * header down the right edge, power + analog down the left — so a model in
 * Arduino's landscape frame (USB on the left, digital header along the top) is
 * turned 90° clockwise: (x, y) → (y, −x). The PCB is 68.58 × 53.34 mm (2.7 ×
 * 2.1 in) on every UNO; the USB and barrel jack overhang the top edge.
 */
import * as THREE from 'three'
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js'

export const MESH_FILENAME = 'model.stl'

/** The UNO PCB in Arduino's landscape frame (x along the long edge). */
export const UNO_PCB = { lengthMm: 68.58, widthMm: 53.34 }

/** The portrait footprint every UNO part declares: [width, height] in mm. */
export const UNO_FOOTPRINT = [UNO_PCB.widthMm, UNO_PCB.lengthMm]

/** Landscape (Arduino) → portrait (part) frame, centred on the PCB. */
export function toPortrait(x, y, pcbMinX = 0, pcbMinY = 0) {
  const lx = x - pcbMinX - UNO_PCB.lengthMm / 2
  const ly = y - pcbMinY - UNO_PCB.widthMm / 2
  return [ly, -lx]
}

// --- Geometry helpers -------------------------------------------------------

function box(sx, sy, sz, cx, cy, cz) {
  const g = new THREE.BoxGeometry(sx, sy, sz)
  g.translate(cx, cy, cz)
  return g
}

function cylZ(d, h, cx, cy, z0, segments = 32) {
  const g = new THREE.CylinderGeometry(d / 2, d / 2, h, segments)
  g.rotateX(Math.PI / 2)
  g.translate(cx, cy, z0 + h / 2)
  return g
}

function holePath(x, y, d) {
  const p = new THREE.Path()
  p.absarc(x, y, d / 2, 0, Math.PI * 2, true)
  return p
}

// --- UNO R3 (generated) -----------------------------------------------------

/**
 * Everything below is in the Eagle board's frame: mm, origin at the bottom-left
 * corner of the PCB, x along the 68.58 mm edge with the USB-B at x = 0 and the
 * digital header along y = 50.8. Positions are the element origins in
 * `UNO-TH_Rev3e.brd`; sizes are the parts' datasheet bodies.
 */
export const UNO_R3 = {
  thicknessMm: 1.6,
  /** The outline (Dimension layer), counter-clockwise, without the r = 1 corners. */
  outline: [
    [0, 0],
    [66.04, 0],
    [66.04, 2.54],
    [68.58, 5.08],
    [68.58, 37.846],
    [66.04, 40.386],
    [66.04, 51.816],
    [64.516, 53.34],
    [0, 53.34]
  ],
  /** Ø3.2 mounting holes. */
  holes: [
    [13.97, 2.54],
    [15.24, 50.8],
    [66.04, 7.62],
    [66.04, 35.56]
  ],
  holeDiameterMm: 3.2,
  /** Female headers: first pin x, pin count, row y. 8.5 mm tall, 2.54 pitch. */
  headers: [
    { name: 'header-digital-high', x0: 18.796, count: 10, y: 50.8 },
    { name: 'header-digital-low', x0: 45.72, count: 8, y: 50.8 },
    { name: 'header-power', x0: 27.94, count: 8, y: 2.54 },
    { name: 'header-analog', x0: 50.8, count: 6, y: 2.54 }
  ],
  headerHeightMm: 8.5,
  /** USB-B receptacle, its mouth 6.35 mm past the PCB edge. */
  usb: { x0: -6.35, x1: 10.0, yMm: 38.1, widthMm: 12.0, heightMm: 10.9 },
  /** 2.1 mm DC barrel jack, 1.9 mm past the edge. */
  jack: { x0: -1.9, x1: 12.5, yMm: 8.382, widthMm: 9.0, heightMm: 11.0 },
  /** ATmega328P (DIP-28) in its turned-pin socket. */
  dip: { xMm: 46.355, yMm: 16.383, socket: [36.3, 10.2, 3.2], chip: [35.0, 7.4, 3.3] },
  /** 2 × 3 ICSP headers: centre, columns along x, rows along y. */
  icsp: [
    { name: 'icsp-328p', xMm: 64.897, yMm: 27.94, cols: 2, rows: 3 },
    { name: 'icsp-16u2', xMm: 18.288, yMm: 46.228, cols: 3, rows: 2 }
  ],
  reset: { xMm: 6.35, yMm: 49.403, bodyMm: 6.0, heightMm: 3.5, capDiameterMm: 3.5, capMm: 1.0 },
  /** The two 47 µF electrolytics by the jack. */
  caps: { diameterMm: 6.3, heightMm: 5.4, positions: [[25.527, 9.144], [18.415, 9.144]] },
  /** Small parts as plain bodies: [name, x, y, w, l, h] (w along x). */
  smd: [
    ['atmega16u2', 19.939, 34.671, 5, 5, 0.9],
    ['crystal-16u2', 18.923, 26.162, 11.4, 4.7, 3.6],
    ['resonator', 41.275, 24.892, 3.2, 1.3, 0.9],
    ['regulator-5v', 7.747, 17.399, 3.5, 6.5, 1.6],
    ['regulator-3v3', 21.971, 15.24, 1.6, 2.9, 1.1],
    ['op-amp', 19.05, 20.32, 3, 3, 1.1],
    ['diode', 21.59, 2.794, 4.6, 3.6, 2.2],
    ['fuse', 4.064, 26.543, 3.2, 4.5, 1.2],
    ['mosfet', 8.128, 26.543, 1.3, 2.9, 1.0],
    ['rn1', 27.94, 23.876, 1.6, 3.2, 0.5],
    ['rn2', 27.94, 39.37, 1.6, 3.2, 0.5],
    ['rn3', 12.827, 36.83, 1.6, 3.2, 0.5],
    ['rn4', 58.42, 33.782, 1.6, 3.2, 0.5],
    ['led-l', 27.94, 42.164, 0.8, 2.0, 0.8],
    ['led-on', 58.42, 36.576, 0.8, 2.0, 0.8]
  ]
}

/** The R3 PCB outline + holes as a `Shape`, in the portrait frame. */
export function unoR3Shape(u = UNO_R3) {
  const s = new THREE.Shape()
  u.outline.forEach(([x, y], i) => {
    const [px, py] = toPortrait(x, y)
    if (i === 0) s.moveTo(px, py)
    else s.lineTo(px, py)
  })
  s.closePath()
  for (const [x, y] of u.holes) s.holes.push(holePath(...toPortrait(x, y), u.holeDiameterMm))
  return s
}

/** A body given in the landscape frame (w along x, l along y), placed portrait. */
function bodyAt(w, l, h, x, y, z0) {
  const [px, py] = toPortrait(x, y)
  return box(l, w, h, px, py, z0 + h / 2)
}

export function unoR3Geometries(u = UNO_R3) {
  const t = u.thicknessMm
  const out = [
    {
      name: 'pcb',
      geo: new THREE.ExtrudeGeometry(unoR3Shape(u), {
        depth: t,
        bevelEnabled: false,
        curveSegments: 16
      })
    }
  ]
  const pitch = 2.54
  for (const h of u.headers) {
    const len = h.count * pitch
    const cx = h.x0 - pitch / 2 + len / 2
    out.push({ name: h.name, geo: bodyAt(len, pitch, u.headerHeightMm, cx, h.y, t) })
  }
  const usb = u.usb
  out.push({
    name: 'usb-b',
    geo: bodyAt(usb.x1 - usb.x0, usb.widthMm, usb.heightMm, (usb.x0 + usb.x1) / 2, usb.yMm, t)
  })
  const j = u.jack
  out.push({
    name: 'dc-jack',
    geo: bodyAt(j.x1 - j.x0, j.widthMm, j.heightMm, (j.x0 + j.x1) / 2, j.yMm, t)
  })
  const d = u.dip
  out.push({ name: 'dip-socket', geo: bodyAt(...d.socket, d.xMm, d.yMm, t) })
  out.push({ name: 'atmega328p', geo: bodyAt(...d.chip, d.xMm, d.yMm, t + d.socket[2] - 1) })
  for (const ic of u.icsp) {
    out.push({
      name: `${ic.name}-base`,
      geo: bodyAt(ic.cols * pitch, ic.rows * pitch, 2.5, ic.xMm, ic.yMm, t)
    })
    for (let c = 0; c < ic.cols; c++)
      for (let r = 0; r < ic.rows; r++) {
        const x = ic.xMm + (c - (ic.cols - 1) / 2) * pitch
        const y = ic.yMm + (r - (ic.rows - 1) / 2) * pitch
        out.push({ name: `${ic.name}-pin`, geo: bodyAt(0.64, 0.64, 8.5, x, y, t) })
      }
  }
  const r = u.reset
  out.push({ name: 'reset', geo: bodyAt(r.bodyMm, r.bodyMm, r.heightMm, r.xMm, r.yMm, t) })
  out.push({
    name: 'reset-cap',
    geo: cylZ(r.capDiameterMm, r.capMm, ...toPortrait(r.xMm, r.yMm), t + r.heightMm, 24)
  })
  u.caps.positions.forEach(([x, y], i) =>
    out.push({
      name: `cap-${i + 1}`,
      geo: cylZ(u.caps.diameterMm, u.caps.heightMm, ...toPortrait(x, y), t)
    })
  )
  for (const [name, x, y, w, l, h] of u.smd) out.push({ name, geo: bodyAt(w, l, h, x, y, t) })
  return out
}

/** The R3 as a three.js group (what the tests measure). */
export function unoR3Group() {
  const group = new THREE.Group()
  const mat = new THREE.MeshBasicMaterial()
  for (const { name, geo } of unoR3Geometries()) {
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

// --- Official STEP → STL -----------------------------------------------------

/**
 * Bodies whose detail costs far more triangles than it shows at board scale —
 * the 0402–0805 passives and the R4 WiFi's 96 matrix LEDs (1,568 triangles
 * each, ~157k in all) — are replaced by their bounding boxes. Everything else
 * is Arduino's mesh as tessellated by OpenCascade.
 */
export const BOX_BODIES = /^(HSMx-190|RES-0402|RES-0603|CAP-0402|CAP-0603|CAP-0805|FER-0603)$/

/**
 * Triangles from an occt-import-js result, in the portrait frame. The PCB is
 * found as the board's landscape footprint anchored at the far (non-USB) end:
 * the USB and jack only overhang x < 0 side, so the PCB spans
 * [maxX − 68.58, maxX] × [minY, minY + 53.34].
 */
export function stepTriangles(result) {
  const raw = []
  let maxX = -Infinity
  let minY = Infinity
  let minZ = Infinity
  for (const m of result.meshes) {
    const p = m.attributes.position.array
    const idx = m.index.array
    let mn = [Infinity, Infinity, Infinity]
    let mx = [-Infinity, -Infinity, -Infinity]
    for (let i = 0; i < p.length; i += 3)
      for (let k = 0; k < 3; k++) {
        mn[k] = Math.min(mn[k], p[i + k])
        mx[k] = Math.max(mx[k], p[i + k])
      }
    maxX = Math.max(maxX, mx[0])
    minY = Math.min(minY, mn[1])
    minZ = Math.min(minZ, mn[2])
    if (BOX_BODIES.test(m.name ?? '')) {
      const b = new THREE.BoxGeometry(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2])
      b.translate((mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2)
      const bp = b.toNonIndexed().attributes.position.array
      for (let i = 0; i < bp.length; i += 9)
        raw.push([0, 3, 6].map((o) => [bp[i + o], bp[i + o + 1], bp[i + o + 2]]))
      continue
    }
    for (let i = 0; i < idx.length; i += 3)
      raw.push([0, 1, 2].map((k) => [p[idx[i + k] * 3], p[idx[i + k] * 3 + 1], p[idx[i + k] * 3 + 2]]))
  }
  const pcbMinX = maxX - UNO_PCB.lengthMm
  return raw.map((tri) =>
    tri.map(([x, y, z]) => [...toPortrait(x, y, pcbMinX, minY), z - minZ])
  )
}

/** Binary STL from a list of triangles ([[x,y,z] × 3]). */
export function trianglesToStl(tris) {
  const buf = Buffer.alloc(84 + tris.length * 50)
  buf.writeUInt32LE(tris.length, 80)
  let off = 84
  for (const [a, b, c] of tris) {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
    const l = Math.hypot(...n) || 1
    for (const q of [...n.map((q) => q / l), ...a, ...b, ...c]) {
      buf.writeFloatLE(q, off)
      off += 4
    }
    off += 2
  }
  return buf
}

// --- CLI -------------------------------------------------------------------

async function main(args) {
  const { readFileSync, writeFileSync } = await import('node:fs')
  const { dirname, resolve } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const outFor = (id) => resolve(repo, `examples/parts/snakie-standard/${id}/${MESH_FILENAME}`)
  const report = (out, stl) =>
    console.log(
      `${out.replace(`${repo}/`, '')} — ${(stl.length - 84) / 50} triangles, ${(stl.length / 1024).toFixed(1)} KB`
    )

  if (args.includes('--r3')) {
    const out = outFor('arduino-uno-r3')
    const stl = toStl(unoR3Group())
    writeFileSync(out, stl)
    report(out, stl)
    return
  }
  const i = args.indexOf('--step')
  if (i >= 0 && args[i + 1] && args[i + 2]) {
    let occt
    try {
      occt = (await import('occt-import-js')).default
    } catch {
      console.error('--step needs the STEP reader: npm i --no-save occt-import-js')
      process.exitCode = 1
      return
    }
    const reader = await occt()
    const result = reader.ReadStepFile(new Uint8Array(readFileSync(resolve(args[i + 2]))), null)
    if (!result.success) throw new Error(`Could not read ${args[i + 2]}`)
    const out = outFor(args[i + 1])
    const stl = trianglesToStl(stepTriangles(result))
    writeFileSync(out, stl)
    report(out, stl)
    return
  }
  console.error('Usage: --r3 | --step <part-id> <file.step>')
  process.exitCode = 1
}

if (typeof process !== 'undefined' && process.argv?.[1]) {
  const { fileURLToPath } = await import('node:url')
  const { resolve } = await import('node:path')
  if (resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main(process.argv.slice(2))
}
