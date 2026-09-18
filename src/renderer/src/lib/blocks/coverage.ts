import { pythonToBlocks, type ConversionReport } from './python-to-blocks'

/**
 * THE COVERAGE RATCHET (W0, #1087, epic #1086).
 * =============================================================================
 *
 * Epic #1007 shipped a reader for *the subset our own generator emits*. Measured
 * against a real corpus of 688 MicroPython files it renders 54.7% of lines as
 * blocks, and epic #1086 is about the other half — teaching it the MicroPython
 * that already exists, in tutorials, in GitHub repos, in somebody's older
 * projects.
 *
 * None of that is worth doing unmeasured, and this is the measurement. It is
 * deliberately the FIRST workstream of the epic rather than the last: retrofit
 * the ratchet after three workstreams have moved the number and you never find
 * out which one moved it.
 *
 * WHAT IT COUNTS, AND WHY IT IS THREE NUMBERS AND NOT ONE.
 *
 *  - **Statement coverage** — recognised / total logical lines. What
 *    `ConversionReport` has always given.
 *  - **Socket coverage** — value sockets holding a real block rather than a grey
 *    one. NOT optional, and the reason is the asymmetry in the reader:
 *    `rawValue()` never increments `report.raw`, only `raw()` does. So
 *    `echo = Pin(0, Pin.IN)` reports `recognised: 1, raw: 0` while rendering as
 *    *set echo to (grey blob)*. Statement coverage is blind to that, and would
 *    stay blind while three workstreams fixed thousands of lines of exactly that
 *    shape — making the epic look like it had barely moved.
 *  - **Clean files** — files with no grey anywhere. The number the learner
 *    actually feels, and the one that moves slowest: one exotic line in a
 *    200-line file still shows.
 *
 * ROUND-TRIP IS THE FOURTH AND IT IS NOT HERE. It lives in the test, because it
 * needs the real generator and this module is pure — `pythonToBlocks` is
 * Blockly-free by design, so coverage can be counted in node over a directory of
 * files with nothing loaded. The test pairs the two: a workstream can always
 * raise a coverage number by recognising something badly, and only round-trip
 * says so.
 *
 * WHAT IT IS MEASURED OVER. `test/fixtures/coverage/` — forty-odd files chosen
 * to span the buckets in `docs/blocks-coverage-epic.md` §3. The real corpus
 * cannot go in the repo (it is 85,000 lines of somebody's personal projects), so
 * the fixture stands in for it and the full run stays available as an
 * environment-gated pass in the same test file for when the two disagree.
 */

/** What one file's conversion contributed. */
export interface FileCoverage {
  /** Whatever the caller called it — a path, usually. */
  name: string
  report: ConversionReport
  /** No grey statement AND no grey socket: the file opens as blocks throughout. */
  clean: boolean
}

/** The totals over a set of files. */
export interface CoverageTotals {
  files: number
  /** Logical lines read, over every file. */
  lines: number
  recognised: number
  raw: number
  sockets: number
  rawSockets: number
  /** Files with no grey at all. */
  clean: number
}

/** Convert one source and read the numbers off the report. */
export function coverageOfFile(name: string, source: string): FileCoverage {
  const { report } = pythonToBlocks(source)
  return { name, report, clean: report.raw === 0 && report.rawSockets === 0 }
}

/** Convert every source and add the numbers up. */
export function coverageOf(files: readonly { name: string; source: string }[]): CoverageTotals {
  const totals: CoverageTotals = {
    files: 0,
    lines: 0,
    recognised: 0,
    raw: 0,
    sockets: 0,
    rawSockets: 0,
    clean: 0
  }
  for (const file of files) {
    const { report, clean } = coverageOfFile(file.name, file.source)
    totals.files += 1
    totals.lines += report.total
    totals.recognised += report.recognised
    totals.raw += report.raw
    totals.sockets += report.sockets
    totals.rawSockets += report.rawSockets
    if (clean) totals.clean += 1
  }
  return totals
}

/** Recognised lines as a percentage, to two places. Zero lines is 100%. */
export function statementCoverage(totals: CoverageTotals): number {
  return percent(totals.recognised, totals.lines)
}

/** Value sockets holding a real block, as a percentage. No sockets is 100%. */
export function socketCoverage(totals: CoverageTotals): number {
  return percent(totals.sockets - totals.rawSockets, totals.sockets)
}

/** Files with no grey at all, as a percentage. */
export function cleanFileShare(totals: CoverageTotals): number {
  return percent(totals.clean, totals.files)
}

function percent(part: number, whole: number): number {
  if (whole === 0) return 100
  return Math.round((part / whole) * 10000) / 100
}

/**
 * The numbers as one line, for a test's failure message and for the manual
 * corpus run.
 *
 * Printed rather than merely asserted because the point of a ratchet is that the
 * number is VISIBLE: somebody raising a floor needs to know what to raise it to,
 * and somebody who lowered one needs to see by how much.
 */
export function coverageSummary(totals: CoverageTotals): string {
  return [
    `${totals.files} files · ${totals.lines} lines`,
    `statements ${statementCoverage(totals).toFixed(2)}% (${totals.raw} raw)`,
    `sockets ${socketCoverage(totals).toFixed(2)}% (${totals.rawSockets}/${totals.sockets} grey)`,
    `clean files ${totals.clean}/${totals.files} (${cleanFileShare(totals).toFixed(2)}%)`
  ].join(' · ')
}
