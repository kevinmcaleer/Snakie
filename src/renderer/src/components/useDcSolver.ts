import { useEffect, useRef, useState } from 'react'
import { solveDC, type SolverCircuit, type SolverState } from '../../../shared/dc-solver'

/**
 * Run the Circuit Sim DC solver (#603) for a circuit, off the main thread.
 *
 * Spawns the {@link file://../web/dc-solver.worker.ts dc-solver worker} once, posts
 * the {@link SolverCircuit} whenever it changes (tagged with a monotonic `seq` so a
 * stale result from an earlier topology is ignored), and returns the latest
 * {@link SolverState}. `null` circuit ⇒ `null` state (nothing to solve).
 *
 * Degrades gracefully: if a Worker can't be constructed (some test / SSR / locked-
 * down environments), it solves SYNCHRONOUSLY on the main thread instead — the solve
 * is tiny (a few dozen nodes), so this is a safe fallback, never a hang.
 */
export function useDcSolver(circuit: SolverCircuit | null): SolverState | null {
  const [state, setState] = useState<SolverState | null>(null)
  const workerRef = useRef<Worker | null>(null)
  const seqRef = useRef(0)

  // Spawn the worker once (and tear it down on unmount).
  useEffect(() => {
    let worker: Worker | null = null
    try {
      worker = new Worker(new URL('../web/dc-solver.worker.ts', import.meta.url), { type: 'module' })
      worker.onmessage = (e: MessageEvent<{ seq: number; state: SolverState }>): void => {
        // Ignore results for a superseded topology.
        if (e.data.seq === seqRef.current) setState(e.data.state)
      }
      worker.onerror = (): void => {
        workerRef.current = null // fall back to synchronous solves
      }
      workerRef.current = worker
    } catch {
      workerRef.current = null
    }
    return () => {
      worker?.terminate()
      workerRef.current = null
    }
  }, [])

  // Re-solve whenever the circuit changes.
  useEffect(() => {
    if (!circuit) {
      setState(null)
      return
    }
    const seq = ++seqRef.current
    const worker = workerRef.current
    if (worker) worker.postMessage({ seq, circuit })
    else setState(solveDC(circuit)) // no worker → solve inline (tiny system)
  }, [circuit])

  return state
}
