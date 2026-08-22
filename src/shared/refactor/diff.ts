/**
 * Line diff for the refactoring preview modal (epic #634 §2.4).
 *
 * "Every offered refactoring shows a diff preview before it touches the file"
 * is one of the epic's acceptance criteria, and the reason is trust: this tool
 * rewrites people's working robot code, so they get to see exactly what will
 * change first.
 *
 * A plain Myers-style LCS over lines is plenty here — refactorings touch a
 * handful of lines in one region, not thousands — and keeping it in `shared`
 * means the hunk-building is unit-testable without a DOM.
 */

/** One line of a rendered diff. */
export interface DiffLine {
  kind: 'context' | 'add' | 'remove'
  /** 1-based line number in the ORIGINAL file (absent for added lines). */
  beforeLine?: number
  /** 1-based line number in the REWRITTEN file (absent for removed lines). */
  afterLine?: number
  text: string
}

/** A contiguous run of changed lines plus its surrounding context. */
export interface DiffHunk {
  beforeStart: number
  afterStart: number
  lines: DiffLine[]
}

/** Longest common subsequence of two line arrays, as index pairs. */
function lcsPairs(a: readonly string[], b: readonly string[]): [number, number][] {
  const n = a.length
  const m = b.length
  // Trim the common prefix and suffix first: refactorings change a small region
  // of an otherwise identical file, so this makes the table tiny.
  let lo = 0
  while (lo < n && lo < m && a[lo] === b[lo]) lo++
  let hiA = n
  let hiB = m
  while (hiA > lo && hiB > lo && a[hiA - 1] === b[hiB - 1]) {
    hiA--
    hiB--
  }

  const pairs: [number, number][] = []
  for (let i = 0; i < lo; i++) pairs.push([i, i])

  const rows = hiA - lo
  const cols = hiB - lo
  if (rows > 0 && cols > 0) {
    // Standard LCS table over the differing middle.
    const table: number[][] = Array.from({ length: rows + 1 }, () => new Array<number>(cols + 1).fill(0))
    for (let i = rows - 1; i >= 0; i--) {
      for (let j = cols - 1; j >= 0; j--) {
        table[i][j] =
          a[lo + i] === b[lo + j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1])
      }
    }
    let i = 0
    let j = 0
    while (i < rows && j < cols) {
      if (a[lo + i] === b[lo + j]) {
        pairs.push([lo + i, lo + j])
        i++
        j++
      } else if (table[i + 1][j] >= table[i][j + 1]) i++
      else j++
    }
  }

  for (let k = 0; k < n - hiA; k++) pairs.push([hiA + k, hiB + k])
  return pairs
}

/**
 * A unified diff of `before` → `after`, grouped into hunks with `context` lines
 * of unchanged code either side. Returns an empty array when nothing changed.
 */
export function diffLines(before: string, after: string, context = 3): DiffHunk[] {
  const a = before.split('\n')
  const b = after.split('\n')
  const pairs = lcsPairs(a, b)

  // Walk both sides, emitting removes/adds for anything not in the LCS.
  const all: DiffLine[] = []
  let i = 0
  let j = 0
  const emitCommon = (ai: number, bi: number): void => {
    while (i < ai) all.push({ kind: 'remove', beforeLine: i + 1, text: a[i++] })
    while (j < bi) all.push({ kind: 'add', afterLine: j + 1, text: b[j++] })
    all.push({ kind: 'context', beforeLine: i + 1, afterLine: j + 1, text: a[i] })
    i++
    j++
  }
  for (const [ai, bi] of pairs) emitCommon(ai, bi)
  while (i < a.length) all.push({ kind: 'remove', beforeLine: i + 1, text: a[i++] })
  while (j < b.length) all.push({ kind: 'add', afterLine: j + 1, text: b[j++] })

  // Group changed lines into hunks, padded with `context` unchanged lines.
  const changed = all.map((l) => l.kind !== 'context')
  if (!changed.some(Boolean)) return []

  const keep = new Array<boolean>(all.length).fill(false)
  for (let k = 0; k < all.length; k++) {
    if (!changed[k]) continue
    for (let d = Math.max(0, k - context); d <= Math.min(all.length - 1, k + context); d++) {
      keep[d] = true
    }
  }

  const hunks: DiffHunk[] = []
  let current: DiffLine[] = []
  const flush = (): void => {
    if (current.length === 0) return
    const first = current[0]
    hunks.push({
      beforeStart: first.beforeLine ?? 1,
      afterStart: first.afterLine ?? 1,
      lines: current
    })
    current = []
  }
  for (let k = 0; k < all.length; k++) {
    if (keep[k]) current.push(all[k])
    else flush()
  }
  flush()
  return hunks
}

/** Total added and removed line counts, for a one-line summary. */
export function diffStats(hunks: readonly DiffHunk[]): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const h of hunks) {
    for (const l of h.lines) {
      if (l.kind === 'add') added++
      else if (l.kind === 'remove') removed++
    }
  }
  return { added, removed }
}
