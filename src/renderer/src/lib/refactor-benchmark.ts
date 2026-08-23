/**
 * Benchmark a refactoring on the real board (epic #634 §3.7, #806).
 *
 * The feature that makes the speed hints trustworthy. Snakie is already holding
 * a raw-REPL connection while it edits, so it can time the user's function
 * before and after a rewrite and show "before 4.2 ms → after 1.9 ms (2.2×)"
 * next to the diff. No other MicroPython tool can do that, because no other one
 * is connected to the board while you type.
 *
 * It also makes the *honest* outcome visible: when `@micropython.native` buys
 * 4%, the user sees 4% and skips it. That is the point — it kills the
 * cargo-culting that is the real failure mode with these decorators.
 *
 * ## The safety problem, and what we do about it
 *
 * Timing a function means running the user's module on the board, and a
 * MicroPython module's top level frequently spins motors. The epic raises this
 * as an open question (§9); the answers this implements are:
 *
 * - Only zero-argument functions are offered. We will not invent arguments for
 *   a function we do not understand.
 * - The module is `exec`'d in its OWN namespace on a scratch basis, and the
 *   caller must click through an explicit warning that says the file is about
 *   to run on the board.
 * - Every run is bounded by an iteration count and wrapped in `ticks_diff`, so
 *   a wrapping tick counter cannot report a nonsense speed-up (see rule 80).
 *
 * Both builders are pure and the parser is pure, so they unit-test against
 * canned REPL output with no hardware — the same shape as `board-packages.ts`.
 */

/** One timing result. */
export interface BenchmarkResult {
  /** Total microseconds for `iterations` calls. */
  totalUs: number
  iterations: number
  /** Microseconds per call. */
  perCallUs: number
}

/** A before/after comparison, ready to render. */
export interface BenchmarkComparison {
  before: BenchmarkResult
  after: BenchmarkResult
  /** `before.perCallUs / after.perCallUs` — above 1 means the rewrite is faster. */
  speedup: number
}

/** Functions we can time: defined at module level and taking no arguments. */
export function zeroArgFunctionNames(source: string): string[] {
  const out: string[] = []
  const re = /^def\s+([A-Za-z_]\w*)\s*\(\s*\)\s*:/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(source)) != null) out.push(m[1])
  return out
}

/**
 * Python that runs `source` in a private namespace and times `funcName`.
 *
 * `ticks_diff` (not a raw subtraction) because the tick counter wraps — the
 * very bug rule 80 exists to catch. A `gc.collect()` before the timed loop
 * keeps a pending collection out of the measurement, and one warm-up call keeps
 * first-call compilation out of it too.
 */
export function buildBenchmarkProbe(source: string, funcName: string, iterations: number): string {
  const n = Math.max(1, Math.min(Math.floor(iterations), 100000))
  return [
    'import time, gc, json',
    '_ns = {}',
    `exec(${JSON.stringify(source)}, _ns)`,
    `_f = _ns[${JSON.stringify(funcName)}]`,
    '_f()',
    'gc.collect()',
    '_t0 = time.ticks_us()',
    `for _ in range(${n}):`,
    '    _f()',
    '_t1 = time.ticks_us()',
    `print(json.dumps({'us': time.ticks_diff(_t1, _t0), 'n': ${n}}))`
  ].join('\n')
}

/** Parse the probe's stdout, tolerating REPL noise around the JSON. */
export function parseBenchmarkResult(stdout: string): BenchmarkResult | null {
  const m = /\{[^{}]*\}/.exec(stdout)
  if (!m) return null
  try {
    const raw = JSON.parse(m[0]) as { us?: unknown; n?: unknown }
    const totalUs = typeof raw.us === 'number' ? raw.us : NaN
    const iterations = typeof raw.n === 'number' ? raw.n : NaN
    if (!Number.isFinite(totalUs) || !Number.isFinite(iterations) || iterations <= 0) return null
    // A negative total means the tick counter wrapped in a way we cannot trust.
    if (totalUs < 0) return null
    return { totalUs, iterations, perCallUs: totalUs / iterations }
  } catch {
    return null
  }
}

/** Combine two runs into the comparison shown beside the diff. */
export function compareBenchmarks(
  before: BenchmarkResult,
  after: BenchmarkResult
): BenchmarkComparison {
  const speedup = after.perCallUs > 0 ? before.perCallUs / after.perCallUs : 1
  return { before, after, speedup }
}

/** Human-readable duration: microseconds under a millisecond, else milliseconds. */
export function formatDuration(us: number): string {
  if (us < 1000) return `${us.toFixed(us < 10 ? 2 : 0)} µs`
  return `${(us / 1000).toFixed(us < 10000 ? 2 : 1)} ms`
}

/**
 * A plain-English verdict. Deliberately blunt about small wins — a 4% gain that
 * costs flash and readability is a gain the user should decline.
 */
export function benchmarkVerdict(speedup: number): string {
  if (speedup >= 1.15) return `${speedup.toFixed(1)}× faster`
  if (speedup >= 1.03) return `only ${Math.round((speedup - 1) * 100)}% faster — probably not worth it`
  if (speedup <= 0.97) return `${(1 / speedup).toFixed(1)}× SLOWER — don't apply this`
  return 'no measurable difference'
}
