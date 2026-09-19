import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect, beforeEach } from 'vitest'
import 'blockly/blocks'
import {
  coverageOf,
  coverageOfFile,
  coverageSummary,
  cleanFileShare,
  socketCoverage,
  statementCoverage
} from '../src/renderer/src/lib/blocks/coverage'
import { pythonToBlocks } from '../src/renderer/src/lib/blocks/python-to-blocks'
import { verifyConversion } from '../src/renderer/src/lib/blocks/round-trip'
import { installBlockDefinitions, resetBlockRegistry } from '../src/renderer/src/lib/blocks/registry'
import { installCorePalette } from '../src/renderer/src/lib/blocks/palette'

/**
 * THE COVERAGE RATCHET (W0, #1087, epic #1086).
 * =============================================================================
 *
 * The number the epic is about, asserted so it cannot quietly go back down.
 *
 * Three floors and a round-trip, which is the whole of `docs/blocks-coverage-epic.md`
 * §2.3. The floors are the point: a reader change that demotes a construct to
 * grey costs nothing today and is found by a learner opening their own file. It
 * should cost a red test instead.
 *
 * RAISING A FLOOR IS PART OF LANDING A WORKSTREAM. When W1 teaches the reader
 * about objects, the numbers below move and the pull request that moves them
 * says by how much. Lowering one is allowed — some trades are worth making — but
 * only out loud, in a diff somebody reviews.
 *
 * WHY THE FLOORS ARE NOT THE EXACT NUMBERS. A floor a percentage point under the
 * measurement leaves room for a fixture to be added without every floor moving
 * with it, which is the difference between a ratchet people maintain and one
 * they delete. `coverageSummary` prints the real numbers on every run, so the
 * headroom is never a mystery.
 */

/**
 * THE FLOORS.
 * ---------------------------------------------------------------------------
 *
 * Measured, then rounded down. Kept together and commented, so that raising them
 * when a workstream lands is one obvious edit rather than an archaeology
 * exercise. `coverageSummary` prints the real numbers on every run, so the
 * headroom between a floor and the measurement is never a mystery.
 */

/**
 * Recognised lines / logical lines. 53.31% at W0, 96.32% at W8, 97.94% at W9,
 * **98.53% after epic #1119**.
 *
 * #1119 is an AUTHORING epic and it moved this anyway, which is worth saying
 * because the two halves are not the same question. Most of its fifteen issues
 * gave a learner a way to BUILD something; a handful of them also taught the
 * reader a line it had been leaving grey — `for name, value in rows:` and
 * `print("x:", x)`, both listed in §10 as still-grey (#1121, #1125), plus
 * `del`, `pass`, a list display and a `def` with a default on it.
 */
const STATEMENT_FLOOR = 98

/**
 * Value sockets holding a real block. 53.88% at W0, 72.41% at W10, 71.58% at W3,
 * 73.17% with `ticks_ms`.
 *
 * ARGUED DOWN ONCE, on purpose and out loud, and for the same reason each time.
 * W3 (#1090) turned every `return <expr>` from a grey STATEMENT into a real
 * block with that expression in a socket; W7 (#1094) did the same for `raise
 * <expr>` and W9 (#1096) for `await <expr>`. Several hundred expressions that
 * were never measured joined the denominator, and some of them (`return
 * found.get(name)`, `raise RuntimeError("bad file")`, `await
 * asyncio.sleep(period)`) are genuinely grey values. Nothing got worse; more of
 * the file is being counted. Statement coverage moved 72.61% → 97.94% across the
 * same changes.
 *
 * AND THEN EPIC #1119 MOVED IT NINE POINTS THE OTHER WAY, 73.17% → **82.25%**,
 * which is the largest single jump this number has had. Sockets are where an
 * authoring epic shows up: a dictionary literal, a list display, a slice, a
 * mask, a hex address, a string method, a format spec, `*args` — every one of
 * them was a grey blob inside a real block, and each is now the block it says
 * it is.
 */
const SOCKET_FLOOR = 81

/**
 * Files that open with no grey at all. 4.65% at W0, 9.30% at W6, 16.28% at W10,
 * **25.58% after epic #1119**.
 *
 * The hardest of the three numbers to move, because ONE grey line disqualifies
 * a whole file — which is also what makes it the one that measures what #1119
 * set out to measure. The epic's own framing was not line coverage but *how
 * often a learner has to drop into the grey escape hatch to say an ordinary
 * thing*, and a file with no grey in it is a file where they never had to.
 * Eleven of forty-three now, from seven.
 */
const CLEAN_FILE_FLOOR = 24

const FIXTURES = join(__dirname, 'fixtures', 'coverage')

/** Every `.py` in the fixture corpus, by name, in a stable order. */
function corpus(dir: string): { name: string; source: string }[] {
  const out: { name: string; source: string }[] = []
  for (const entry of readdirSync(dir).sort()) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      out.push(...corpus(path))
      continue
    }
    if (!entry.endsWith('.py')) continue
    out.push({ name: path, source: readFileSync(path, 'utf8') })
  }
  return out
}

const files = corpus(FIXTURES)

beforeEach(() => {
  resetBlockRegistry()
  installCorePalette()
  installBlockDefinitions()
})

describe('the fixture corpus', () => {
  it('spans enough files to be a corpus at all', () => {
    // Forty-odd, chosen to span the buckets in §3 of the delivery plan. A
    // handful of files would make every floor below noise.
    expect(files.length).toBeGreaterThanOrEqual(40)
  })

  it('is real MicroPython, not fragments', () => {
    // Every fixture names the buckets it stands for on its first line, so a
    // reader can tell at a glance why a file is in here.
    for (const file of files) {
      expect(file.source.length).toBeGreaterThan(40)
      expect(file.source.split('\n')[0].startsWith('#') || file.source.startsWith('"""')).toBe(true)
    }
  })
})

describe('coverage over the fixture corpus', () => {
  const totals = coverageOf(files)

  it('recognises at least the statement floor', () => {
    expect(`${coverageSummary(totals)}`).toBeTruthy()
    expect(statementCoverage(totals)).toBeGreaterThanOrEqual(STATEMENT_FLOOR)
  })

  it('fills at least the socket floor with real blocks', () => {
    expect(socketCoverage(totals)).toBeGreaterThanOrEqual(SOCKET_FLOOR)
  })

  it('opens at least the clean-file floor with no grey at all', () => {
    expect(cleanFileShare(totals)).toBeGreaterThanOrEqual(CLEAN_FILE_FLOOR)
  })

  it('reads the whole corpus quickly enough to sit on a file open', () => {
    // The reader runs on every Blocks open, so a workstream that makes it
    // quadratic is a UI hang rather than a slow test (§7). The real corpus is
    // 688 files in ~430ms; this is the same budget per file with a wide margin
    // for a loaded CI box.
    const started = Date.now()
    for (const file of files) pythonToBlocks(file.source)
    expect(Date.now() - started).toBeLessThan(files.length * 20)
  })
})

describe('round-trip over the fixture corpus', () => {
  // THE HALF THAT CANNOT BE GAMED. A workstream can always raise a coverage
  // number by recognising something badly; only this says so.
  for (const file of files) {
    it(`regenerates ${file.name.slice(FIXTURES.length + 1)} unchanged`, async () => {
      const { workspace } = pythonToBlocks(file.source)
      expect(await verifyConversion(file.source, workspace)).toEqual({ ok: true })
    })
  }
})

describe('the numbers each file contributes', () => {
  it('never reports more recognised lines than it read', () => {
    for (const file of files) {
      const { report } = coverageOfFile(file.name, file.source)
      expect(report.recognised + report.raw).toBe(report.total)
      expect(report.rawSockets).toBeLessThanOrEqual(report.sockets)
    }
  })
})

/**
 * The same three numbers over a REAL corpus, for when the fixture and reality
 * disagree.
 *
 *     SNAKIE_CORPUS=~/MicroPython npx vitest run test/blocksCoverageRatchet
 *
 * Nothing is asserted — the corpus is somebody's own directory and its numbers
 * are not the repo's to gate on. It prints, which is what it is for.
 */
describe.runIf(process.env.SNAKIE_CORPUS)('the manual corpus run', () => {
  it('prints the numbers', () => {
    const totals = coverageOf(corpus(process.env.SNAKIE_CORPUS!))
    // eslint-disable-next-line no-console
    console.log(coverageSummary(totals))
    expect(totals.files).toBeGreaterThan(0)
  })
})
