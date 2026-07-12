/**
 * Clean-URDF export for the Robot View builder (#315, epic #309 Phase 5).
 * =============================================================================
 *
 * The Robot View edits its URDF in place with targeted string surgery, so the
 * live file can accumulate irregular whitespace. "Export URDF" writes a tidy,
 * consistently-indented copy into the project's `urdf/` folder — a clean artifact
 * to share, version, or hand to another tool, that re-loads unchanged in the
 * viewer. Dependency-free (no DOMParser) so it runs in the renderer AND is
 * unit-testable in node.
 */

/** Pretty-print URDF/XML with two-space indentation per nesting level. */
export function prettyUrdf(xml: string): string {
  // Collapse whitespace that sits purely BETWEEN tags, then split one tag/line.
  const compact = xml.replace(/>\s+</g, '><').trim()
  const tokens = compact.replace(/></g, '>\n<').split('\n')
  const pad = (n: number): string => '  '.repeat(Math.max(0, n))
  const out: string[] = []
  let depth = 0
  for (const raw of tokens) {
    const line = raw.trim()
    if (!line) continue
    const isDecl = line.startsWith('<?') || line.startsWith('<!')
    const isClose = line.startsWith('</')
    const isSelfClose = line.endsWith('/>')
    // `<tag ...>text</tag>` collapsed onto one line — no net depth change.
    const isInline = /^<[^/!?][^>]*>[^<]*<\/[^>]+>$/.test(line)
    const isOpen = line.startsWith('<') && !isClose && !isSelfClose && !isDecl && !isInline
    if (isClose) depth--
    out.push(pad(depth) + line)
    if (isOpen) depth++
  }
  return out.join('\n') + '\n'
}

/** The robot's `name` from `<robot name="…">`, or `'robot'`. */
export function robotNameOf(xml: string): string {
  const m = /<robot\b[^>]*\bname\s*=\s*"([^"]*)"/i.exec(xml)
  return (m?.[1] || 'robot').trim() || 'robot'
}

/** `<baseDir>/urdf/<safe-name>.urdf` — the canonical export location. */
export function urdfExportPath(baseDir: string, name: string): string {
  const safe = (name || 'robot').replace(/[^A-Za-z0-9_.-]+/g, '_').replace(/^_+|_+$/g, '') || 'robot'
  const dir = baseDir.replace(/[/\\]+$/, '')
  return `${dir ? dir + '/' : ''}urdf/${safe}.urdf`
}
