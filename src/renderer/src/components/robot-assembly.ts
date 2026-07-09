/**
 * ROBOT ASSEMBLY HELPERS (epic #309) — pure text utilities for the pose tool's
 * assembly panel + STL import: reading a URDF's links + the mesh files they use,
 * and appending an imported mesh as a new (loose, unconnected) link. Regex-based
 * (no DOM) so they're cheap to unit-test in a node env.
 */
import type { PrimitiveKind, Vec3 } from './robot-build'

/**
 * A minimal, VALID starter URDF: one `base_link` with a small box so the pose
 * tool renders something out of the box. Imported STLs come in as loose parts the
 * user joins explicitly. `name` is sanitised to a URDF-safe robot name.
 */
export function blankUrdf(name = 'my_robot'): string {
  const safe = name.replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'my_robot'
  return (
    `<?xml version="1.0"?>\n` +
    `<!-- New robot — add links/joints, or import meshes from the Assembly panel. -->\n` +
    `<robot name="${safe}">\n` +
    `  <material name="steel"><color rgba="0.62 0.65 0.69 1"/></material>\n` +
    `  <link name="base_link">\n` +
    `    <visual>\n` +
    `      <geometry><box size="0.08 0.08 0.02"/></geometry>\n` +
    `      <material name="steel"/>\n` +
    `    </visual>\n` +
    `  </link>\n` +
    `</robot>\n`
  )
}

/** One link of the model + the visual geometry it uses. */
export interface AssemblyItem {
  link: string
  kind: 'mesh' | 'box' | 'cylinder' | 'sphere' | 'none'
  /** For `kind: 'mesh'`, the mesh filename as written in the URDF. */
  mesh?: string
}

/** The links of a URDF + their visual geometry, in document order. */
export function parseAssembly(urdf: string): AssemblyItem[] {
  const items: AssemblyItem[] = []
  const seen = new Set<string>()
  const openRe = /<link\b([^>]*?)(\/?)>/g
  let m: RegExpExecArray | null
  while ((m = openRe.exec(urdf))) {
    const attrs = m[1]
    const selfClose = m[2] === '/'
    const name = /\bname\s*=\s*"([^"]+)"/.exec(attrs)?.[1]
    if (!name || seen.has(name)) continue
    seen.add(name)
    let body = ''
    if (!selfClose) {
      const end = urdf.indexOf('</link>', openRe.lastIndex)
      body = end >= 0 ? urdf.slice(openRe.lastIndex, end) : ''
    }
    const mesh = /<mesh\b[^>]*\bfilename\s*=\s*"([^"]+)"/i.exec(body)?.[1]
    if (mesh) {
      items.push({ link: name, kind: 'mesh', mesh })
    } else {
      const prim = /<(box|cylinder|sphere)\b/i.exec(body)?.[1]
      items.push({ link: name, kind: (prim?.toLowerCase() as AssemblyItem['kind']) ?? 'none' })
    }
  }
  return items
}

/** The distinct mesh files a URDF references, in first-seen order. */
export function meshFiles(urdf: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const re = /<mesh\b[^>]*\bfilename\s*=\s*"([^"]+)"/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(urdf))) {
    if (!seen.has(m[1])) {
      seen.add(m[1])
      out.push(m[1])
    }
  }
  return out
}

/** The root link — one that is never a joint `child` (falls back to the first
 *  link). Used as the parent when attaching an imported mesh. */
export function rootLink(urdf: string): string | undefined {
  const links = parseAssembly(urdf).map((i) => i.link)
  if (links.length === 0) return undefined
  const children = new Set<string>()
  const re = /<child\b[^>]*\blink\s*=\s*"([^"]+)"/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(urdf))) children.add(m[1])
  return links.find((l) => !children.has(l)) ?? links[0]
}

/** A link name derived from `base`, made XML-safe + unique within the URDF. */
export function uniqueLinkName(urdf: string, base: string): string {
  const existing = new Set(parseAssembly(urdf).map((i) => i.link))
  const safe = base.replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'part'
  if (!existing.has(safe)) return safe
  let n = 2
  while (existing.has(`${safe}_${n}`)) n++
  return `${safe}_${n}`
}

/**
 * Append an imported mesh to a URDF as a new **loose** link — no joint, so it
 * comes in as an unconnected part (a root) the user then designates as the base
 * or joins into the chain with the Add Joint tool. (Auto-welding every import to
 * the root with a fixed joint fused the whole assembly into one rigid blob.)
 * `meshRel` is the mesh path relative to the URDF folder (e.g. `meshes/wheel.stl`).
 * Returns the new URDF text and the created link name.
 */
export function addMeshLink(
  urdf: string,
  opts: { meshRel: string; linkBase: string; scale?: number }
): { urdf: string; link: string } {
  const name = uniqueLinkName(urdf, opts.linkBase)
  // A `scale` normalises a mesh authored in different units (e.g. mm → m).
  const s = opts.scale && opts.scale !== 1 ? ` scale="${fmtNum(opts.scale)} ${fmtNum(opts.scale)} ${fmtNum(opts.scale)}"` : ''
  const block =
    `  <link name="${name}">\n` +
    `    <visual>\n` +
    `      <geometry><mesh filename="${opts.meshRel}"${s}/></geometry>\n` +
    `    </visual>\n` +
    `  </link>\n`
  const idx = urdf.lastIndexOf('</robot>')
  const next = idx < 0 ? `${urdf.trimEnd()}\n${block}` : urdf.slice(0, idx) + block + urdf.slice(idx)
  return { urdf: next, link: name }
}

/**
 * The **unconnected** links: every link that is a root (never a joint's `<child>`)
 * EXCEPT the chosen base. These are parts imported but not yet joined into the
 * chain. `base` is the designated base link (from robot.yml, or the sole root).
 */
export function looseLinks(urdf: string, base?: string | null): string[] {
  const links = parseAssembly(urdf).map((i) => i.link)
  const children = new Set<string>()
  const re = /<child\b[^>]*\blink\s*=\s*"([^"]+)"/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(urdf))) children.add(m[1])
  return links.filter((l) => !children.has(l) && l !== base)
}

/**
 * Rename a link everywhere it's referenced: its `<link name="…">` and every
 * joint's `<parent link="…">` / `<child link="…">`. `to` is sanitised to an
 * XML-safe name, made unique (a collision with another link bumps a suffix); a
 * rename to the same name is a no-op. Returns the new URDF + the final name.
 */
export function renameLink(urdf: string, from: string, to: string): { urdf: string; name: string } {
  const safe = to.replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'part'
  if (safe === from) return { urdf, name: from }
  const existing = new Set(parseAssembly(urdf).map((i) => i.link))
  existing.delete(from)
  let name = safe
  let n = 2
  while (existing.has(name)) name = `${safe}_${n++}`
  // URDF link references are case-SENSITIVE — match the link def + its joint refs
  // with the same case so a rename can't rewrite a different-cased link's joints.
  const e = escapeRe(from)
  const out = urdf
    .replace(new RegExp(`(<link\\b[^>]*\\bname\\s*=\\s*")${e}(")`, 'g'), `$1${name}$2`)
    .replace(new RegExp(`(<parent\\b[^>]*\\blink\\s*=\\s*")${e}(")`, 'g'), `$1${name}$2`)
    .replace(new RegExp(`(<child\\b[^>]*\\blink\\s*=\\s*")${e}(")`, 'g'), `$1${name}$2`)
  return { urdf: out, name }
}

// ── Primitive builder (#315a) ────────────────────────────────────────────────

/** A primitive link's geometry, read from / written to the URDF. Sizes in metres:
 *  box `dims=[x,y,z]`, cylinder `[radius,length]`, sphere `[radius]`. */
export interface PrimitiveGeom {
  kind: PrimitiveKind
  dims: number[]
  /** The visual `<origin xyz>` (default [0,0,0]). */
  origin: [number, number, number]
}

/** Compact metre formatter — up to 4 dp, trailing zeros stripped (`0.05`, `0.1`). */
function fmtNum(n: number): string {
  return (Math.round(n * 1e4) / 1e4).toString()
}
function fmtVec(v: readonly number[]): string {
  return v.map(fmtNum).join(' ')
}
function parseVec3(s: string): [number, number, number] {
  const p = s.trim().split(/\s+/).map(Number)
  return [p[0] || 0, p[1] || 0, p[2] || 0]
}
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** The `<link name="X"> … </link>` span in the text (byte offsets), or null. */
function linkSpan(
  urdf: string,
  name: string
): { start: number; end: number; bodyStart: number; bodyEnd: number } | null {
  const re = /<link\b([^>]*?)(\/?)>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(urdf))) {
    const nm = /\bname\s*=\s*"([^"]+)"/.exec(m[1])?.[1]
    if (nm !== name) continue
    const openEnd = re.lastIndex
    if (m[2] === '/') return { start: m.index, end: openEnd, bodyStart: openEnd, bodyEnd: openEnd }
    const close = urdf.indexOf('</link>', openEnd)
    if (close < 0) return null
    return { start: m.index, end: close + 7, bodyStart: openEnd, bodyEnd: close }
  }
  return null
}

/** The `<box|cylinder|sphere .../>` tag for a primitive. */
function primitiveTag(kind: PrimitiveKind, dims: readonly number[]): string {
  if (kind === 'cylinder') return `<cylinder radius="${fmtNum(dims[0])}" length="${fmtNum(dims[1])}"/>`
  if (kind === 'sphere') return `<sphere radius="${fmtNum(dims[0])}"/>`
  return `<box size="${fmtVec(dims)}"/>`
}

/** Sensible kid-friendly starter size (metres) per kind. */
export function defaultPrimitiveDims(kind: PrimitiveKind): number[] {
  if (kind === 'cylinder') return [0.02, 0.06]
  if (kind === 'sphere') return [0.03]
  return [0.04, 0.04, 0.04]
}

/** Ensure a `<material name="X">` DEFINITION exists (a bare ref renders default). */
function ensureMaterial(urdf: string, name: string): string {
  if (new RegExp(`<material\\b[^>]*\\bname\\s*=\\s*"${name}"[^>]*>[\\s\\S]*?</material>`).test(urdf)) {
    return urdf
  }
  const def = `  <material name="${name}"><color rgba="0.62 0.65 0.69 1"/></material>\n`
  const m = /<robot\b[^>]*>/i.exec(urdf)
  return m ? urdf.slice(0, m.index + m[0].length) + '\n' + def + urdf.slice(m.index + m[0].length) : def + urdf
}

/** The first `<visual> … </visual>` sub-span within a link body, or null. Scopes
 *  edits to the VISUAL (never a sibling `<collision>`, which also has geometry). */
function visualSlice(body: string): { start: number; end: number } | null {
  const open = /<visual\b[^>]*>/i.exec(body)
  if (!open) return null
  const close = body.indexOf('</visual>', open.index + open[0].length)
  if (close < 0) return null
  return { start: open.index, end: close + 9 }
}

/** Read a primitive link's geometry + visual origin, or null (mesh/none link). */
export function readPrimitive(urdf: string, link: string): PrimitiveGeom | null {
  const span = linkSpan(urdf, link)
  if (!span) return null
  const body = urdf.slice(span.bodyStart, span.bodyEnd)
  const vs = visualSlice(body)
  if (!vs) return null
  const visual = body.slice(vs.start, vs.end)
  const originM = /<origin\b[^>]*\bxyz\s*=\s*"([^"]+)"/i.exec(visual)
  const origin = originM ? parseVec3(originM[1]) : ([0, 0, 0] as [number, number, number])
  const box = /<box\b[^>]*\bsize\s*=\s*"([^"]+)"/i.exec(visual)
  if (box) return { kind: 'box', dims: parseVec3(box[1]), origin }
  const cyl = /<cylinder\b[^>]*>/i.exec(visual)?.[0]
  if (cyl) {
    const r = Number(/\bradius\s*=\s*"([^"]+)"/i.exec(cyl)?.[1])
    const l = Number(/\blength\s*=\s*"([^"]+)"/i.exec(cyl)?.[1])
    return { kind: 'cylinder', dims: [r || 0, l || 0], origin }
  }
  const sph = /<sphere\b[^>]*\bradius\s*=\s*"([^"]+)"/i.exec(visual)
  if (sph) return { kind: 'sphere', dims: [Number(sph[1]) || 0], origin }
  return null
}

/** Rewrite ONLY the primitive geometry tag inside a link's VISUAL (any kind, any
 *  self-closing or open/close form). */
export function setPrimitiveSize(urdf: string, link: string, dims: readonly number[]): string {
  const span = linkSpan(urdf, link)
  if (!span) return urdf
  const body = urdf.slice(span.bodyStart, span.bodyEnd)
  const vs = visualSlice(body)
  if (!vs) return urdf
  const visual = body
    .slice(vs.start, vs.end)
    .replace(/<(box|cylinder|sphere)\b[\s\S]*?(?:\/>|<\/\1>)/i, (_full, kind) =>
      primitiveTag(kind.toLowerCase() as PrimitiveKind, dims)
    )
  const nextBody = body.slice(0, vs.start) + visual + body.slice(vs.end)
  return urdf.slice(0, span.bodyStart) + nextBody + urdf.slice(span.bodyEnd)
}

/** Read a link's `<visual><origin>` (xyz + rpy), for ANY geometry (mesh included),
 *  or null when the link has no visual. */
export function readVisualOrigin(
  urdf: string,
  link: string
): { xyz: [number, number, number]; rpy: [number, number, number] } | null {
  const span = linkSpan(urdf, link)
  if (!span) return null
  const body = urdf.slice(span.bodyStart, span.bodyEnd)
  const vs = visualSlice(body)
  if (!vs) return null
  const visual = body.slice(vs.start, vs.end)
  const x = /<origin\b[^>]*\bxyz\s*=\s*"([^"]+)"/i.exec(visual)
  const r = /<origin\b[^>]*\brpy\s*=\s*"([^"]+)"/i.exec(visual)
  return { xyz: x ? parseVec3(x[1]) : [0, 0, 0], rpy: r ? parseVec3(r[1]) : [0, 0, 0] }
}

/** Insert-or-replace a link's `<visual><origin>` (keeps the opposite face put).
 *  `rpy` defaults to zero; pass it to also orient the visual. Handles both the
 *  self-closing and open `<origin>…</origin>` tag forms. */
export function setVisualOrigin(
  urdf: string,
  link: string,
  xyz: readonly [number, number, number],
  rpy: readonly [number, number, number] = [0, 0, 0]
): string {
  const span = linkSpan(urdf, link)
  if (!span) return urdf
  const body = urdf.slice(span.bodyStart, span.bodyEnd)
  const vs = visualSlice(body)
  if (!vs) return urdf
  const tag = `<origin xyz="${fmtVec(xyz)}" rpy="${fmtVec(rpy)}"/>`
  const originRe = /<origin\b[^>]*\/>|<origin\b[^>]*>[\s\S]*?<\/origin>/i
  let visual = body.slice(vs.start, vs.end)
  if (originRe.test(visual)) visual = visual.replace(originRe, tag)
  else visual = visual.replace(/<visual\b[^>]*>/i, (v) => `${v}\n      ${tag}`)
  const nextBody = body.slice(0, vs.start) + visual + body.slice(vs.end)
  return urdf.slice(0, span.bodyStart) + nextBody + urdf.slice(span.bodyEnd)
}

/** Read the joint whose `<child>` is `childLink`, or null (e.g. the root link has
 *  none — the move tool uses that to refuse moving the base). */
/** The four joint types the builder can author (a subset of the URDF set). */
export type JointType = 'fixed' | 'revolute' | 'continuous' | 'prismatic'
const JOINT_TYPES: readonly string[] = ['fixed', 'revolute', 'continuous', 'prismatic']

export interface JointDef {
  name: string
  parent: string
  type: JointType
  xyz: Vec3
  rpy: Vec3
  /** The rotation/slide axis, or null for a fixed joint (no `<axis>`). */
  axis: Vec3 | null
  /** Native lower/upper (rad for revolute, m for prismatic); null when absent. */
  limit: { lower: number; upper: number } | null
  /** A `<mimic>` coupling (`value = multiplier·master + offset`), or null. */
  mimic: { joint: string; multiplier: number; offset: number } | null
}

/** A joint definition that also carries its child link (from `readAllJoints`). */
export interface JointFull extends JointDef {
  child: string
}

/** Parse one `<joint>` from its opening attrs + inner body. */
function parseJoint(attrs: string, body: string): JointFull {
  const originM = /<origin\b[^>]*\bxyz\s*=\s*"([^"]+)"/i.exec(body)
  const rpyM = /<origin\b[^>]*\brpy\s*=\s*"([^"]+)"/i.exec(body)
  const axisM = /<axis\b[^>]*\bxyz\s*=\s*"([^"]+)"/i.exec(body)
  const limM = /<limit\b([^>]*?)\/?>/i.exec(body)
  const lower = limM ? /\blower\s*=\s*"([^"]+)"/.exec(limM[1])?.[1] : undefined
  const upper = limM ? /\bupper\s*=\s*"([^"]+)"/.exec(limM[1])?.[1] : undefined
  const mimM = /<mimic\b([^>]*?)\/?>/i.exec(body)
  const typeRaw = /\btype\s*=\s*"([^"]+)"/.exec(attrs)?.[1] ?? 'fixed'
  return {
    name: /\bname\s*=\s*"([^"]+)"/.exec(attrs)?.[1] ?? '',
    type: (JOINT_TYPES.includes(typeRaw) ? typeRaw : 'fixed') as JointType,
    parent: /<parent\b[^>]*\blink\s*=\s*"([^"]+)"/i.exec(body)?.[1] ?? '',
    child: /<child\b[^>]*\blink\s*=\s*"([^"]+)"/i.exec(body)?.[1] ?? '',
    xyz: originM ? parseVec3(originM[1]) : [0, 0, 0],
    rpy: rpyM ? parseVec3(rpyM[1]) : [0, 0, 0],
    axis: axisM ? parseVec3(axisM[1]) : null,
    limit: lower != null && upper != null ? { lower: Number(lower), upper: Number(upper) } : null,
    mimic: mimM
      ? {
          joint: /\bjoint\s*=\s*"([^"]+)"/.exec(mimM[1])?.[1] ?? '',
          multiplier: Number(/\bmultiplier\s*=\s*"([^"]+)"/.exec(mimM[1])?.[1] ?? '1'),
          offset: Number(/\boffset\s*=\s*"([^"]+)"/.exec(mimM[1])?.[1] ?? '0')
        }
      : null
  }
}

/** The full definition of the joint whose CHILD is `childLink`, or null (root). */
export function readJoint(urdf: string, childLink: string): JointDef | null {
  const re = /<joint\b([^>]*)>([\s\S]*?)<\/joint>/gi
  const childRe = new RegExp(`<child\\b[^>]*\\blink\\s*=\\s*"${escapeRe(childLink)}"`, 'i')
  let m: RegExpExecArray | null
  while ((m = re.exec(urdf))) {
    if (childRe.test(m[2])) return parseJoint(m[1], m[2])
  }
  return null
}

/** Every `<joint>` in the model (with its child link), in document order. */
export function readAllJoints(urdf: string): JointFull[] {
  const re = /<joint\b([^>]*)>([\s\S]*?)<\/joint>/gi
  const out: JointFull[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(urdf))) {
    const j = parseJoint(m[1], m[2])
    if (j.child) out.push(j)
  }
  return out
}

/** Names of every `<joint>` in the model (for the mimic master picker). */
export function jointNames(urdf: string): string[] {
  const re = /<joint\b([^>]*)>/gi
  const out: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(urdf))) {
    const nm = /\bname\s*=\s*"([^"]+)"/.exec(m[1])?.[1]
    if (nm) out.push(nm)
  }
  return out
}

/** A sensible native limit when a joint first becomes movable. */
export function defaultJointLimit(type: JointType): { lower: number; upper: number } {
  return type === 'prismatic'
    ? { lower: 0, upper: 0.05 } // 0–50 mm
    : { lower: -Math.PI / 2, upper: Math.PI / 2 } // ±90°
}

export interface JointSpec {
  type: JointType
  /** Rotation/slide axis (movable joints); defaults to +Z. */
  axis?: Vec3
  /** Native lower/upper (rad/m) for revolute/prismatic; defaults per type. */
  lower?: number
  upper?: number
  /** A `<mimic>` coupling, or null/undefined for none. */
  mimic?: { joint: string; multiplier: number; offset: number } | null
}

/**
 * Rewrite the joint whose child is `childLink` to a new type + axis/limit/mimic,
 * PRESERVING its name, parent and origin. The block is regenerated wholesale
 * (not surgically patched) so a type change can never strand a stale
 * `<axis>`/`<limit>`/`<mimic>`. Movable joints get an `<axis>`; revolute/prismatic
 * additionally get a `<limit>` (the URDF spec requires it), continuous a bare
 * effort/velocity limit. Returns the URDF unchanged if the joint isn't found.
 */
export function setJoint(urdf: string, childLink: string, spec: JointSpec): string {
  const re = /<joint\b[^>]*>[\s\S]*?<\/joint>/gi
  const childRe = new RegExp(`<child\\b[^>]*\\blink\\s*=\\s*"${escapeRe(childLink)}"`, 'i')
  let m: RegExpExecArray | null
  while ((m = re.exec(urdf))) {
    if (!childRe.test(m[0])) continue
    const blk = m[0]
    const name = /\bname\s*=\s*"([^"]+)"/.exec(blk)?.[1] ?? `${childLink}_joint`
    const parent = /<parent\b[^>]*\blink\s*=\s*"([^"]+)"/i.exec(blk)?.[1] ?? ''
    const oxyz = /<origin\b[^>]*\bxyz\s*=\s*"([^"]+)"/i.exec(blk)?.[1] ?? '0 0 0'
    const orpy = /<origin\b[^>]*\brpy\s*=\s*"([^"]+)"/i.exec(blk)?.[1] ?? '0 0 0'
    const { type } = spec
    const movable = type !== 'fixed'
    const axis = spec.axis ?? [0, 0, 1]
    let inner =
      `    <parent link="${parent}"/>\n` +
      `    <child link="${childLink}"/>\n` +
      `    <origin xyz="${oxyz}" rpy="${orpy}"/>\n`
    if (movable) inner += `    <axis xyz="${fmtVec(axis)}"/>\n`
    if (type === 'revolute' || type === 'prismatic') {
      const def = defaultJointLimit(type)
      const lower = spec.lower ?? def.lower
      const upper = spec.upper ?? def.upper
      inner += `    <limit lower="${fmtNum(lower)}" upper="${fmtNum(upper)}" effort="1" velocity="1"/>\n`
    } else if (type === 'continuous') {
      inner += `    <limit effort="1" velocity="1"/>\n`
    }
    if (movable && spec.mimic && spec.mimic.joint) {
      const mi = spec.mimic
      inner += `    <mimic joint="${mi.joint}" multiplier="${fmtNum(mi.multiplier)}" offset="${fmtNum(mi.offset)}"/>\n`
    }
    const block = `  <joint name="${name}" type="${type}">\n${inner}  </joint>`
    return urdf.slice(0, m.index) + block + urdf.slice(m.index + m[0].length)
  }
  return urdf
}

/** A link + every descendant reachable through child joints (transitive). Used
 *  by the Join tool to forbid a re-parent that would create a cycle. */
export function subtreeOf(urdf: string, link: string): Set<string> {
  const inside = new Set<string>([link])
  const jointOf = (block: string, attr: 'parent' | 'child'): string | undefined =>
    new RegExp(`<${attr}\\b[^>]*\\blink\\s*=\\s*"([^"]+)"`, 'i').exec(block)?.[1]
  for (let changed = true; changed; ) {
    changed = false
    const re = /<joint\b[^>]*>[\s\S]*?<\/joint>/gi
    let m: RegExpExecArray | null
    while ((m = re.exec(urdf))) {
      const parent = jointOf(m[0], 'parent')
      const child = jointOf(m[0], 'child')
      if (parent && child && inside.has(parent) && !inside.has(child)) {
        inside.add(child)
        changed = true
      }
    }
  }
  return inside
}

/**
 * Decide the parent/child orientation for a joint between two links (#354). A URDF
 * tree needs the child NOT to already sit above the parent; if making `a` the
 * parent of `b` would form a loop but the reverse wouldn't, swap them. When either
 * order works (or neither), keep `a` as the parent.
 */
export function orientJoint(urdf: string, a: string, b: string): { parent: string; child: string } {
  if (subtreeOf(urdf, b).has(a) && !subtreeOf(urdf, a).has(b)) return { parent: b, child: a }
  return { parent: a, child: b }
}

/** A joint name derived from `base`, made unique within the URDF. */
function uniqueJointName(urdf: string, base: string): string {
  const existing = new Set(jointNames(urdf))
  if (!existing.has(base)) return base
  let n = 2
  while (existing.has(`${base}_${n}`)) n++
  return `${base}_${n}`
}

/** Render a complete `<joint>` block from parsed fields — regenerated wholesale
 *  (never surgically patched) so it's immune to open-vs-self-closing tag forms and
 *  can't strand/duplicate a child tag. Movable joints get an `<axis>`;
 *  revolute/prismatic additionally a `<limit>`, continuous a bare effort/velocity. */
function renderJointBlock(j: JointFull): string {
  const movable = j.type !== 'fixed'
  let inner =
    `    <parent link="${j.parent}"/>\n` +
    `    <child link="${j.child}"/>\n` +
    `    <origin xyz="${fmtVec(j.xyz)}" rpy="${fmtVec(j.rpy)}"/>\n`
  if (movable) inner += `    <axis xyz="${fmtVec(j.axis ?? [0, 0, 1])}"/>\n`
  if (j.type === 'revolute' || j.type === 'prismatic') {
    const lim = j.limit ?? defaultJointLimit(j.type)
    inner += `    <limit lower="${fmtNum(lim.lower)}" upper="${fmtNum(lim.upper)}" effort="1" velocity="1"/>\n`
  } else if (j.type === 'continuous') {
    inner += `    <limit effort="1" velocity="1"/>\n`
  }
  if (movable && j.mimic && j.mimic.joint) {
    const mi = j.mimic
    inner += `    <mimic joint="${mi.joint}" multiplier="${fmtNum(mi.multiplier)}" offset="${fmtNum(mi.offset)}"/>\n`
  }
  return `  <joint name="${j.name}" type="${j.type}">\n${inner}  </joint>`
}

/**
 * The Join tool (#354): connect `child` (Component 2) under `parent` (Component 1)
 * at joint origin `xyz`. If the child already has a parent joint it is re-parented
 * (parent + origin rewritten, type/axis/limits preserved); otherwise a new fixed
 * joint is created. Refuses a no-op or a re-parent that would form a cycle
 * (parent within the child's own subtree) — returns the URDF unchanged.
 */
export function connectJoint(
  urdf: string,
  opts: { parent: string; child: string; xyz?: readonly [number, number, number] }
): string {
  const { parent, child } = opts
  const xyz: Vec3 = [...(opts.xyz ?? [0, 0, 0])] as Vec3
  if (!parent || !child || parent === child) return urdf
  // A URDF is a tree: attaching `child` under one of its own descendants (or
  // itself) would create a loop the loader can't build.
  if (subtreeOf(urdf, child).has(parent)) return urdf
  // Re-parent the child's existing joint by regenerating its block wholesale
  // (accepts any tag form; preserves type/axis/limit/mimic + rpy).
  const re = /<joint\b([^>]*)>([\s\S]*?)<\/joint>/gi
  const childRe = new RegExp(`<child\\b[^>]*\\blink\\s*=\\s*"${escapeRe(child)}"`, 'i')
  let m: RegExpExecArray | null
  while ((m = re.exec(urdf))) {
    if (!childRe.test(m[2])) continue
    const j = parseJoint(m[1], m[2])
    const block = renderJointBlock({ ...j, parent, child, xyz })
    return urdf.slice(0, m.index) + block + urdf.slice(m.index + m[0].length)
  }
  // No existing joint (child is the root / an orphan) → create a fixed one.
  const name = uniqueJointName(urdf, `${child}_joint`)
  const block =
    renderJointBlock({
      name,
      type: 'fixed',
      parent,
      child,
      xyz,
      rpy: [0, 0, 0],
      axis: null,
      limit: null,
      mimic: null
    }) + '\n'
  const idx = urdf.lastIndexOf('</robot>')
  return idx < 0 ? `${urdf.trimEnd()}\n${block}` : urdf.slice(0, idx) + block + urdf.slice(idx)
}

/** Set the joint origin whose child is `childLink` (moves/orients the whole part).
 *  `rpy` defaults to zero (a plain translation); pass it to orient the joint. */
export function setJointOrigin(
  urdf: string,
  childLink: string,
  xyz: readonly [number, number, number],
  rpy: readonly [number, number, number] = [0, 0, 0]
): string {
  const re = /<joint\b[^>]*>[\s\S]*?<\/joint>/gi
  const childRe = new RegExp(`<child\\b[^>]*\\blink\\s*=\\s*"${escapeRe(childLink)}"`, 'i')
  const originRe = /<origin\b[^>]*\/>|<origin\b[^>]*>[\s\S]*?<\/origin>/i
  let m: RegExpExecArray | null
  while ((m = re.exec(urdf))) {
    if (!childRe.test(m[0])) continue
    const tag = `<origin xyz="${fmtVec(xyz)}" rpy="${fmtVec(rpy)}"/>`
    const block = originRe.test(m[0])
      ? m[0].replace(originRe, tag)
      : m[0].replace(/<\/joint>/i, `  ${tag}\n  </joint>`)
    return urdf.slice(0, m.index) + block + urdf.slice(m.index + m[0].length)
  }
  return urdf
}

/**
 * Add a primitive as a new link + FIXED joint onto `parent` (root fallback), so it
 * attaches to the selected part. Returns the new URDF + the created link name.
 */
export function addPrimitive(
  urdf: string,
  opts: {
    kind: PrimitiveKind
    parent?: string
    linkBase?: string
    dims?: number[]
    origin?: [number, number, number]
    jointXyz?: [number, number, number]
  }
): { urdf: string; link: string } {
  const parent = opts.parent ?? rootLink(urdf)
  const name = uniqueLinkName(urdf, opts.linkBase ?? opts.kind)
  const dims = opts.dims ?? defaultPrimitiveDims(opts.kind)
  const origin = opts.origin ?? [0, 0, 0]
  const jointXyz = opts.jointXyz ?? [0.06, 0, 0] // beside the parent so it doesn't overlap
  const linkBlock =
    `  <link name="${name}">\n` +
    `    <visual>\n` +
    `      <origin xyz="${fmtVec(origin)}" rpy="0 0 0"/>\n` +
    `      <geometry>${primitiveTag(opts.kind, dims)}</geometry>\n` +
    `      <material name="steel"/>\n` +
    `    </visual>\n` +
    `  </link>\n`
  const jointBlock = parent
    ? `  <joint name="${name}_joint" type="fixed">\n` +
      `    <parent link="${parent}"/>\n` +
      `    <child link="${name}"/>\n` +
      `    <origin xyz="${fmtVec(jointXyz)}" rpy="0 0 0"/>\n` +
      `  </joint>\n`
    : ''
  const block = linkBlock + jointBlock
  const idx = urdf.lastIndexOf('</robot>')
  const next = idx < 0 ? `${urdf.trimEnd()}\n${block}` : urdf.slice(0, idx) + block + urdf.slice(idx)
  return { urdf: ensureMaterial(next, 'steel'), link: name }
}

/**
 * Remove the `<joint>` whose child is `childLink` (leaves the child a detached
 * root — the caller keeps it in place / re-homes it). Returns the URDF unchanged
 * when no such joint exists. Handles any joint-tag / attribute layout.
 */
export function removeJoint(urdf: string, childLink: string): string {
  const re = /\s*<joint\b[^>]*>[\s\S]*?<\/joint>/gi
  const childRe = new RegExp(`<child\\b[^>]*\\blink\\s*=\\s*"${escapeRe(childLink)}"`, 'i')
  let removedName: string | undefined
  let out = urdf.replace(re, (block) => {
    if (!childRe.test(block)) return block
    removedName = /\bname\s*=\s*"([^"]+)"/.exec(block)?.[1]
    return '\n'
  })
  // A joint that MIMICKED the removed one now dangles — drop the stale <mimic>.
  if (removedName) {
    const mimicRe = new RegExp(
      `\\s*<mimic\\b[^>]*\\bjoint\\s*=\\s*"${escapeRe(removedName)}"[^>]*\\/?>`,
      'gi'
    )
    out = out.replace(mimicRe, '')
  }
  return out
}

/**
 * Remove a link AND its whole subtree (every descendant reachable through child
 * joints), plus every joint that references any removed link. A URDF is a tree —
 * deleting a non-leaf block otherwise leaves a joint with a dangling parent, which
 * crashes the loader. Best-effort, corruption-safe.
 */
export function removeLink(urdf: string, link: string): string {
  // Collect the subtree: `link` + everything joined below it (transitively).
  const doomed = new Set<string>([link])
  const jointOf = (block: string, attr: 'parent' | 'child'): string | undefined =>
    new RegExp(`<${attr}\\b[^>]*\\blink\\s*=\\s*"([^"]+)"`, 'i').exec(block)?.[1]
  for (let changed = true; changed; ) {
    changed = false
    const re = /<joint\b[^>]*>[\s\S]*?<\/joint>/gi
    let m: RegExpExecArray | null
    while ((m = re.exec(urdf))) {
      const parent = jointOf(m[0], 'parent')
      const child = jointOf(m[0], 'child')
      if (parent && child && doomed.has(parent) && !doomed.has(child)) {
        doomed.add(child)
        changed = true
      }
    }
  }
  let out = urdf
  for (const name of doomed) {
    const span = linkSpan(out, name)
    if (!span) continue
    let start = span.start
    while (start > 0 && /\s/.test(out[start - 1])) start--
    out = out.slice(0, start) + '\n' + out.slice(span.end)
  }
  // Drop every joint touching a removed link (as parent OR child).
  out = out.replace(/\s*<joint\b[^>]*>[\s\S]*?<\/joint>/gi, (block) => {
    const parent = jointOf(block, 'parent')
    const child = jointOf(block, 'child')
    return (parent && doomed.has(parent)) || (child && doomed.has(child)) ? '\n' : block
  })
  return out
}
