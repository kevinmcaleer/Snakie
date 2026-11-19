/**
 * How big is this STL, in its own units? A dependency-free parse that runs in
 * BOTH the Electron main process and the browser.
 *
 * It started in `src/main/robot/` (Node `Buffer` only). The web build needs the
 * same number when it copies a bundled part's model into a project, so the mm→m
 * import scale comes out identical on both hosts — hence it now reads through a
 * `DataView` and a `TextDecoder`, which a Node `Buffer` (a `Uint8Array`) and a
 * browser `Uint8Array` both satisfy. `src/main/robot/stl-measure.ts` re-exports
 * it so existing importers keep their path.
 */

/**
 * The largest bounding-box span of an STL (binary OR ASCII), in the file's own
 * units — a cheap DOM/three-free parse so the mm→m import heuristic works
 * without the renderer.  Returns undefined for a malformed buffer (caller falls
 * back to declared units).
 *
 * THE DELIBERATE TWIN of the renderer's `maxSpan` in
 * `src/renderer/src/components/robot-mesh-load.ts` (#742). That one uses
 * three.js, so this is the one duplicate the refactor kept rather than removed.
 * The two MUST agree: the number they produce picks the mm→m import scale, so a
 * disagreement ships a part a thousand times too big. `test/meshMeasure.test.ts`
 * holds them against the same fixtures; change one and run it.
 */
export function stlMaxDim(buf: Uint8Array): number | undefined {
  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
  const grow = (x: number, y: number, z: number): void => {
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
    if (z < minZ) minZ = z
    if (z > maxZ) maxZ = z
  }
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const tris = buf.length >= 84 ? view.getUint32(80, true) : 0
  if (tris > 0 && buf.length === 84 + tris * 50) {
    // BINARY STL: exactly 84 + 50·tris bytes. Each triangle: normal(12) + 3 verts(36) + attr(2).
    for (let t = 0; t < tris; t++) {
      const base = 84 + t * 50 + 12 // skip the facet normal
      for (let v = 0; v < 3; v++) {
        const o = base + v * 12
        grow(view.getFloat32(o, true), view.getFloat32(o + 4, true), view.getFloat32(o + 8, true))
      }
    }
  } else {
    // ASCII STL: `vertex <x> <y> <z>` lines.
    const text = new TextDecoder().decode(buf)
    if (!/^\s*solid\b/i.test(text)) return undefined
    // The `-` inside the class is what lets a negative EXPONENT (e.g. 1.5e-3) match.
    const re = /\bvertex\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)/g
    let m: RegExpExecArray | null
    let found = false
    while ((m = re.exec(text))) {
      found = true
      grow(Number(m[1]), Number(m[2]), Number(m[3]))
    }
    if (!found) return undefined
  }
  const span = Math.max(maxX - minX, maxY - minY, maxZ - minZ)
  return Number.isFinite(span) ? span : undefined
}
