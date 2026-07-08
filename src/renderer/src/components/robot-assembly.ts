/**
 * ROBOT ASSEMBLY HELPERS (epic #309) — pure text utilities for the pose tool's
 * assembly panel + STL import: reading a URDF's links + the mesh files they use,
 * and appending an imported mesh as a new link/joint. Regex-based (no DOM) so
 * they're cheap to unit-test in a node env.
 */

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
 * Append an imported mesh to a URDF as a new link (+ a fixed joint onto the root
 * link) so it shows in the model immediately. `meshRel` is the mesh path
 * relative to the URDF folder (e.g. `meshes/wheel.stl`). Returns the new URDF
 * text and the created link name.
 */
export function addMeshLink(
  urdf: string,
  opts: { meshRel: string; linkBase: string }
): { urdf: string; link: string } {
  const parent = rootLink(urdf)
  const name = uniqueLinkName(urdf, opts.linkBase)
  const joint = parent
    ? `  <joint name="${name}_joint" type="fixed">\n` +
      `    <parent link="${parent}"/>\n` +
      `    <child link="${name}"/>\n` +
      `    <origin xyz="0 0 0" rpy="0 0 0"/>\n` +
      `  </joint>\n`
    : '' // first link of an empty URDF needs no joint
  const block =
    `  <link name="${name}">\n` +
    `    <visual>\n` +
    `      <geometry><mesh filename="${opts.meshRel}"/></geometry>\n` +
    `    </visual>\n` +
    `  </link>\n` +
    joint
  const idx = urdf.lastIndexOf('</robot>')
  const next = idx < 0 ? `${urdf.trimEnd()}\n${block}` : urdf.slice(0, idx) + block + urdf.slice(idx)
  return { urdf: next, link: name }
}
