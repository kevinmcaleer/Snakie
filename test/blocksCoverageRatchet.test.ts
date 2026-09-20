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
 *
 * **98.58% with the class fixtures of epic #1206 (B6, #1225).** Four
 * class-heavy files joined the corpus and the number did not move, which is the
 * finding and not the disappointment: the reader has understood `class`, `def
 * name(self)` and `self.x = …` since W6 of #1086. Two grey *lines* came in with
 * them — an `@name.setter` header (B3, #1222 folds it) and a `super().blink(1)`
 * used as a statement — and a good many grey *sockets*, which is the number
 * below and where the classes track is actually visible.
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
 *
 * **83.70% with the class fixtures (B6, #1225), and the floor goes 81 → 82.**
 * The floor had been left two and a half points under the measurement since
 * #1119; the four new files take the denominator from 484 sockets to 552 and
 * the measurement barely moves (83.88% → 83.70%), so the headroom is real and
 * some of it is worth taking. What the new files put in the denominator is the
 * classes track's own to-do list, counted rather than asserted: every
 * `Motor(14, 15)`, `Queue()`, `Thermostat(19.5)` is a grey socket today and a
 * `snakie_new_instance` once B5 (#1224) lands.
 *
 * **B4 (#1223) does not appear in this number, and we checked rather than
 * assumed.** `self.speed` and `tail.next` read as `snakie_python_attr_get` /
 * `_set`, and `GREY_VALUE_TYPES` in `python-to-blocks.ts` holds exactly
 * `snakie_python_value` and `snakie_python_call_value` — the attribute pair was
 * never counted as grey, and `attr_set` is a recognised statement, so
 * `motor_driver.py` reports `raw: 0` with six `self.x = …` lines in it. Giving
 * attributes native blocks is a real win for the learner and an invisible one
 * to the ratchet. That is a gap in the measurement, not a reason to distrust
 * B4; §5 of `docs/blocks-classes-epic.md` records it and what to do about it.
 */
const SOCKET_FLOOR = 82

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
 *
 * **23.40% with the class fixtures (B6, #1225): the same eleven files, out of
 * forty-seven. This floor goes DOWN, 24 → 23, deliberately and out loud.**
 *
 * Nothing regressed. Four files were added and none of them is clean, because
 * a class-heavy file always constructs something — and a constructor call is a
 * grey socket until B5 (#1224). Lowering a floor to admit harder fixtures is
 * the one lowering this ratchet was always meant to allow: the alternative is
 * a corpus that only ever gains files the reader already handles, which
 * measures the reader against itself. The number to watch is what B5 and B3 do
 * to it from here — `node_queue.py` is two grey sockets of `Node(value)` /
 * `Queue()` away from clean, and `thermostat.py` one `@target.setter` line.
 */
const CLEAN_FILE_FLOOR = 23

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

/**
 * THE CLASS CLUSTER, MEASURED (B6, #1225, epic #1206).
 * ---------------------------------------------------------------------------
 *
 * The three floors above are corpus-wide and a class-shaped change moves them
 * by fractions of a point. This slice is the classes track's own number: the
 * files that define a class, on their own, so that B2–B5 have somewhere to show
 * up and a reader regression in the class cluster cannot hide inside
 * forty-seven files of everything else.
 *
 * It asserts a floor the same way, and it asserts the *shape* too — every
 * `class` header in the corpus reads as a real `snakie_class` block. A
 * recogniser that quietly demoted one to grey would keep the percentages
 * roughly where they are and fail here.
 *
 * Measured at B6: **15 files · 321 lines · statements 99.38% · sockets 88.18%
 * (26/220 grey) · clean 3/15**. Both floors a point under, as above.
 */
const CLASS_SOCKET_FLOOR = 87
const CLASS_STATEMENT_FLOOR = 99

describe('the class-heavy slice of the corpus (B6, #1225)', () => {
  const classFiles = files.filter((file) => /^class \w/m.test(file.source))
  const totals = coverageOf(classFiles)

  it('has enough class-heavy files to be a slice at all', () => {
    // #1086's corpus had a handful; B6 added motor_driver, thermostat,
    // blinker_subclass and node_queue to span __init__, properties, super(),
    // staticmethod, instance creation and attribute get/set.
    expect(classFiles.length).toBeGreaterThanOrEqual(10)
  })

  it('recognises at least the class statement floor', () => {
    expect(`${coverageSummary(totals)}`).toBeTruthy()
    expect(statementCoverage(totals)).toBeGreaterThanOrEqual(CLASS_STATEMENT_FLOOR)
  })

  it('fills at least the class socket floor with real blocks', () => {
    expect(socketCoverage(totals)).toBeGreaterThanOrEqual(CLASS_SOCKET_FLOOR)
  })

  it('reads every class header as a real class block', () => {
    for (const file of classFiles) {
      const headers = (file.source.match(/^class \w/gm) ?? []).length
      const { workspace } = pythonToBlocks(file.source)
      const read = JSON.stringify(workspace).split('"snakie_class"').length - 1
      expect({ file: file.name, read }).toEqual({ file: file.name, read: headers })
    }
  })
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
