/**
 * Does `v` look like a version at all? (#757)
 *
 * The guard exists because a version string is not always a version. A vendor
 * MicroPython build was seen reporting its BRANCH NAME where the version goes,
 * and the parse below turns anything non-numeric into `0`: `'sherlock-v1.24'`
 * became `0.0.0`, so every catalog build looked newer than it and the user was
 * offered an "update" from a firmware we had failed to identify.
 *
 * "Looks like a version" means it starts with a number: `1.28.0`, `v1.28.0`,
 * `10.2.1`, `10.3.0-alpha.1`. A name does not, and comparing against one has no
 * meaningful answer — so callers get `false`, which reads as "no update", rather
 * than a confident wrong one.
 */
export function isVersionLike(v: string): boolean {
  return /^v?\d+(\.\d+)*(?:[-+].*)?$/i.test(String(v ?? '').trim())
}

/**
 * Is `latest` strictly newer than `current`? (#507 — the updater used a plain
 * string inequality, so ANY difference — including running a build NEWER than
 * the published release — prompted a "downgrade" that then failed.)
 * Numeric dotted compare; a pre-release suffix ranks below its plain version.
 *
 * Either side failing {@link isVersionLike} yields `false`: an unidentifiable
 * version is not evidence of anything, least of all that an update is due.
 */
export function isNewerVersion(latest: string, current: string): boolean {
  if (!isVersionLike(latest) || !isVersionLike(current)) return false
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
