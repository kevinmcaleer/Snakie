/**
 * Is `latest` strictly newer than `current`? (#507 — the updater used a plain
 * string inequality, so ANY difference — including running a build NEWER than
 * the published release — prompted a "downgrade" that then failed.)
 * Numeric dotted compare; a pre-release suffix ranks below its plain version.
 */
export function isNewerVersion(latest: string, current: string): boolean {
  const parse = (v: string): { nums: number[]; pre: string } => {
    const [core, ...pre] = v.replace(/^v/i, '').split('-')
    return { nums: core.split('.').map((n) => parseInt(n, 10) || 0), pre: pre.join('-') }
  }
  const a = parse(latest)
  const b = parse(current)
  for (let i = 0; i < 3; i++) {
    const d = (a.nums[i] ?? 0) - (b.nums[i] ?? 0)
    if (d !== 0) return d > 0
  }
  if (a.pre === b.pre) return false
  if (!a.pre) return !!b.pre // 1.2.3 > 1.2.3-beta
  if (!b.pre) return false
  return a.pre > b.pre
}
