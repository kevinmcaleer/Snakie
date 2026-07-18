# Shared IK solver (`src/shared/ik`)

Pure-TypeScript planar inverse-kinematics solver for Snakie's skeleton work
(epic [#533](https://github.com/kevinmcaleer/snakie/issues/533) §3, issue
[#538](https://github.com/kevinmcaleer/snakie/issues/538)). No Three.js, no
DOM, no Electron — plain vector math, so the identical algorithm can run in
the renderer (Robot View goal gizmo), the web app, Node tests, **and** as a
MicroPython mirror (`snakie_ik.py`, #539) on a Pico.

## Model and conventions

Both implementations MUST use exactly these conventions:

- Chains are **planar** (XY plane) with the base joint pinned at the origin.
  A chain is `N >= 1` bones; joint `i` precedes bone `i`.
- `angles[i]` is the **relative** angle (radians) of joint `i`: the absolute
  heading of bone `i` is `angles[0] + … + angles[i]`. Heading `0` points
  `+X`; positive angles turn counter-clockwise (CCW).
- Forward kinematics: `p0 = (0,0)`,
  `p[i+1] = p[i] + L[i] * (cos(h_i), sin(h_i))` with `h_i` the cumulative
  heading. `p[N]` is the end effector.
- Angles are normalised to the half-open interval `[-PI, PI)`.
- Joint limits are inclusive `[min, max]` on the **relative** angle with
  `-PI <= min <= max <= PI`; `null` (or an omitted list) means unlimited.
  Returned angles are ALWAYS inside the limits — the solver clamps and never
  folds through a limit.

## API

```ts
import { solveIk } from '../../shared/ik'

const result = solveIk(
  { boneLengths: [60, 40], limits: [[-1.6, 1.6], [0, 2.6]] }, // chain
  [50, 30], // target [x, y]
  { currentAngles: [0, 0.5], tolerance: 1e-4, maxIterations: 64 }
)
// result: { status, angles, position, error, iterations }
```

- `status` is `'reached'` | `'out_of_reach'` | `'blocked_by_limits'`:
  - `reached` — the effector landed within `tolerance` of the target.
  - `out_of_reach` — geometrically impossible regardless of limits: the
    target is beyond the total bone length, or (2-bone chains) inside the
    inner dead-zone annulus `|L1 - L2|`. Wins over limit trouble when both
    apply. The returned pose is the best effort aiming at the target.
  - `blocked_by_limits` — geometrically reachable, but the joint limits
    prevent it. The returned pose is the best clamped pose found.
- Invalid input throws `Error` with one of the stable codes
  `invalid_chain` (no bones), `invalid_bone_length` (zero/negative/
  non-finite), `invalid_limits` (length mismatch, `min > max`, outside
  `[-PI, PI]`), `invalid_angles` (`currentAngles` length mismatch).

Dispatch by bone count: 1 bone → analytical aim; 2 bones → exact
law-of-cosines solver; 3+ bones → FABRIK.

### 2-bone analytical solver (`two-bone.ts`)

```
d  = |target|
cos(t2) = (d² - L1² - L2²) / (2·L1·L2)      clamped into [-1, 1]
t2 = ±acos(…)                                elbow up (A) / elbow down (B)
t1 = atan2(ty, tx) - atan2(L2·sin t2, L1 + L2·cos t2)
```

Candidate selection (deterministic, mirrored by #539):
1. If exactly one of A/B satisfies the limits, take it.
2. If both do, take the one closest to `currentAngles` (sum of wrapped
   absolute per-joint differences); ties pick A.
3. If neither does, clamp both into the limits and take the smaller
   forward-kinematics error; ties pick the pose closest to current, then A.

### FABRIK solver, 3+ bones (`fabrik.ts`)

Deterministic pipeline (each later phase only runs while the error is still
above `tolerance`); a faithful mirror implements the phases identically:

0. **Out of reach** (`|target| >` total length): stretch every bone straight
   towards the target, project onto the limits once, return `out_of_reach`.
1. **FABRIK passes** from the limit-clamped current pose. One iteration =
   backward pass (pin effector on target, walk to base restoring bone
   lengths), forward pass (pin base at origin, walk back out), then limit
   projection: positions → relative angles → wrap → clamp → FK.
2. **CCD refinement**: sweeps end → base; each joint rotates the effector
   towards the target, clamped to its limit; stops when a sweep stops
   improving. (Covers FABRIK's slow convergence near the straight-arm
   singularity and limit-pinned poses.)
3. **Analytic two-group fallback**: for each split `k` treat the chain as a
   2-bone arm with straight segments `A = L[0..k-1]`, `B = L[k..n-1]` and
   solve exactly (splits in ascending `k`, elbow `+` before `-`); first
   clamped candidate within tolerance wins. Exact at the reach boundary.
4. **Perturbed-seed retry**: rerun phases 1–2 once from the current pose
   bent by `+0.5 / -0.5` rad on alternating joints (escapes singular
   straight-line seeds, e.g. a target at the base). Best result anywhere
   wins.

## Shared test vectors — `test/fixtures/ik-vectors.json`

The vector file is the cross-language contract: the TypeScript suite
(`test/ikSolver.test.ts`) and the future MicroPython suite (#539) run **the
same file**. It is plain JSON — no NaN/Infinity, no comments — so any
runtime can load it.

```jsonc
{
  "format": "snakie-ik-vectors",
  "version": 1,
  "cases": [
    {
      "id": "unique-descriptive-id",
      "description": "human-readable summary",
      "input": {
        "boneLengths": [1, 1],          // required, N >= 0 (empty tests the guard)
        "limits": [[-1.6, 1.6], null],  // optional; null list or entry = free
        "currentAngles": [0, 0],        // optional; defaults to all zeros
        "target": [1, 1],               // required [x, y]
        "tolerance": 1e-4,              // optional; defaults to 1e-4
        "maxIterations": 64             // optional; defaults to 64
      },
      "expected": {
        // EITHER a thrown/raised error code…
        "throws": "invalid_bone_length",
        // …OR a solve outcome:
        "status": "reached",            // required unless "throws"
        "angles": [0, 1.5707963],       // optional exact-pose assertion
        "angleTolerance": 1e-4,         //   required alongside "angles"
        "position": [1, 1],             // optional effector assertion
        "positionTolerance": 1e-6       //   required alongside "position"
      }
    }
  ]
}
```

**Runner semantics** — a conforming test harness must, per case:

1. If `expected.throws` is present: assert the solver throws/raises an error
   whose message is exactly that code. Nothing else is checked.
2. Otherwise run the solver with `input` and assert
   `result.status === expected.status`.
3. Always assert every returned angle is inside `[-PI, PI)` and inside its
   joint limit (allow `1e-9` slack).
4. If `expected.status` is `"reached"`: recompute forward kinematics from
   the returned angles (do NOT trust `result.position`) and assert the
   effector is within `input.tolerance` (or the 1e-4 default) of the target.
5. If `expected.angles` is present: assert
   `|wrapToPi(actual[i] - expected[i])| <= angleTolerance` for every joint
   (wrapping the difference makes `+PI` and `-PI` equivalent).
6. If `expected.position` is present: assert the Euclidean distance between
   `result.position` and `expected.position` is `<= positionTolerance`.

Cases where the exact pose is implementation-sensitive (iterative FABRIK
solves, float32-hostile cancellation, degenerate `sin(PI)` signs) assert
status + FK only; deterministic analytic/clamp/stretch cases also pin the
angles. Tolerances are chosen so a single-precision (float32) MicroPython
build still passes — keep new vectors' `angleTolerance >= 1e-4` unless the
value is exact by construction.

**Adding vectors**: keep ids descriptive and kebab-case, keep the file
runnable by both implementations, and update BOTH suites' expectations —
never encode TS-only behaviour here.
