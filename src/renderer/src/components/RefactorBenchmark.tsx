import { useMemo, useState } from 'react'
import { useDeviceStatus } from '../hooks/useDeviceStatus'
import {
  benchmarkVerdict,
  buildBenchmarkProbe,
  compareBenchmarks,
  formatDuration,
  parseBenchmarkResult,
  zeroArgFunctionNames,
  type BenchmarkComparison
} from '../lib/refactor-benchmark'
import type { RefactorPreviewDetail } from './refactor-bus'

/** How many times to call the function per run. */
const ITERATIONS = 200

/**
 * "Measure it, don't guess it" — the on-device benchmark beside the diff
 * (epic #634 §3.7, #806).
 *
 * Only offered when there is a board connected AND the file has a zero-argument
 * module-level function we can call without inventing arguments for it. Running
 * it executes the user's module on the board, so the button says exactly that
 * before it does anything.
 */
export function RefactorBenchmark({ request }: { request: RefactorPreviewDetail }): JSX.Element | null {
  const status = useDeviceStatus()
  const connected = status.state === 'connected'
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<BenchmarkComparison | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [target, setTarget] = useState<string>('')

  // Only functions that exist, unchanged in name, on BOTH sides can be compared.
  const candidates = useMemo(() => {
    const before = new Set(zeroArgFunctionNames(request.before))
    return zeroArgFunctionNames(request.after).filter((n) => before.has(n))
  }, [request.before, request.after])

  const chosen = target || candidates[0] || ''

  if (!connected || candidates.length === 0) return null

  const run = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const beforeOut = await window.api.device.eval(
        buildBenchmarkProbe(request.before, chosen, ITERATIONS)
      )
      const before = parseBenchmarkResult(beforeOut)
      const afterOut = await window.api.device.eval(
        buildBenchmarkProbe(request.after, chosen, ITERATIONS)
      )
      const after = parseBenchmarkResult(afterOut)
      if (!before || !after) {
        setError("The board didn't return a usable timing — it may have raised inside your code.")
        return
      }
      setResult(compareBenchmarks(before, after))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The benchmark could not run on the board.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="refactor-bench">
      <div className="refactor-bench__row">
        <button type="button" className="btn btn--ghost" onClick={() => void run()} disabled={busy}>
          {busy ? 'Timing on the board…' : 'Benchmark on device'}
        </button>
        {candidates.length > 1 && (
          <label className="refactor-bench__pick">
            Function
            <select value={chosen} onChange={(e) => setTarget(e.target.value)} disabled={busy}>
              {candidates.map((name) => (
                <option key={name} value={name}>
                  {name}()
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <p className="refactor-bench__warning">
        This runs your file on the connected board and calls <code>{chosen}()</code>{' '}
        {ITERATIONS} times — twice. Anything your module does at import time will happen.
      </p>
      {error && <p className="refactor-bench__error">{error}</p>}
      {result && (
        <p className="refactor-bench__result">
          <strong>{formatDuration(result.before.perCallUs)}</strong> →{' '}
          <strong>{formatDuration(result.after.perCallUs)}</strong> per call —{' '}
          <span
            className={
              result.speedup >= 1.15
                ? 'refactor-bench__verdict refactor-bench__verdict--good'
                : result.speedup <= 0.97
                  ? 'refactor-bench__verdict refactor-bench__verdict--bad'
                  : 'refactor-bench__verdict'
            }
          >
            {benchmarkVerdict(result.speedup)}
          </span>
        </p>
      )}
    </div>
  )
}
