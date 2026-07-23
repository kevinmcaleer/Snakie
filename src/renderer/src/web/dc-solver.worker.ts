/**
 * DC SOLVER WORKER (Circuit Sim #603) — runs the pure {@link solveDC} MNA solve off
 * the main thread, mirroring how the MicroPython sim runs in `mp.worker.ts`. The
 * board view (`BoardGraph`) posts a {@link SolverCircuit} + a monotonic `seq`
 * whenever the topology or a live source/switch changes; the worker solves and posts
 * the {@link SolverState} back tagged with the same `seq` so stale results are
 * dropped. The whole engine is dependency-free, so this file is a thin shell.
 */
import { solveDC, type SolverCircuit, type SolverState } from '../../../shared/dc-solver'

interface SolveMsg {
  seq: number
  circuit: SolverCircuit
}
interface ResultMsg {
  seq: number
  state: SolverState
}

self.onmessage = (e: MessageEvent<SolveMsg>): void => {
  const { seq, circuit } = e.data
  const msg: ResultMsg = { seq, state: solveDC(circuit) }
  postMessage(msg)
}
