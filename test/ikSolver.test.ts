import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  forwardKinematics,
  solveIk,
  wrapToPi,
  type IkChain,
  type IkResult,
  type IkStatus,
  type JointLimit
} from '../src/shared/ik'

// ---------------------------------------------------------------------------
// Shared language-neutral vectors (src/shared/ik/README.md documents the
// format; the MicroPython implementation (#539) must pass the same file).
// ---------------------------------------------------------------------------

interface VectorCase {
  id: string
  description?: string
  input: {
    boneLengths: number[]
    limits?: ([number, number] | null)[] | null
    currentAngles?: number[]
    target: [number, number]
    tolerance?: number
    maxIterations?: number
  }
  expected: {
    throws?: string
    status?: IkStatus
    angles?: number[]
    angleTolerance?: number
    position?: [number, number]
    positionTolerance?: number
  }
}

const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/ik-vectors.json', import.meta.url), 'utf8')
) as { format: string; version: number; cases: VectorCase[] }

const LIMIT_SLACK = 1e-9

function chainOf(input: VectorCase['input']): IkChain {
  return { boneLengths: input.boneLengths, limits: input.limits ?? null }
}

function assertWithinLimits(input: VectorCase['input'], angles: number[]): void {
  angles.forEach((a, i) => {
    expect(a).toBeGreaterThanOrEqual(-Math.PI - LIMIT_SLACK)
    expect(a).toBeLessThan(Math.PI + LIMIT_SLACK)
    const lim = input.limits?.[i]
    if (lim) {
      expect(a).toBeGreaterThanOrEqual(lim[0] - LIMIT_SLACK)
      expect(a).toBeLessThanOrEqual(lim[1] + LIMIT_SLACK)
    }
  })
}

describe('ik-vectors.json — shared cross-language vectors (#538)', () => {
  it('has the expected format header and unique descriptive ids', () => {
    expect(fixture.format).toBe('snakie-ik-vectors')
    expect(fixture.version).toBe(1)
    expect(fixture.cases.length).toBeGreaterThanOrEqual(30)
    const ids = fixture.cases.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const c of fixture.cases) {
      // Either a throws-expectation or a status — never both, never neither.
      expect(Boolean(c.expected.throws) !== Boolean(c.expected.status)).toBe(true)
      if (c.expected.angles) expect(c.expected.angleTolerance).toBeTypeOf('number')
      if (c.expected.position) expect(c.expected.positionTolerance).toBeTypeOf('number')
    }
  })

  for (const c of fixture.cases) {
    it(c.id, () => {
      const { input, expected } = c
      const opts = {
        currentAngles: input.currentAngles,
        tolerance: input.tolerance,
        maxIterations: input.maxIterations
      }

      if (expected.throws) {
        expect(() => solveIk(chainOf(input), input.target, opts)).toThrowError(expected.throws)
        return
      }

      const result = solveIk(chainOf(input), input.target, opts)
      expect(result.status).toBe(expected.status)
      assertWithinLimits(input, result.angles)

      if (expected.status === 'reached') {
        // Recompute FK from the returned angles — don't trust result.position.
        const [x, y] = forwardKinematics(input.boneLengths, result.angles)
        const tol = input.tolerance ?? 1e-4
        expect(Math.hypot(x - input.target[0], y - input.target[1])).toBeLessThanOrEqual(tol)
      }
      if (expected.angles) {
        expect(result.angles).toHaveLength(expected.angles.length)
        expected.angles.forEach((a, i) => {
          expect(Math.abs(wrapToPi(result.angles[i] - a))).toBeLessThanOrEqual(
            expected.angleTolerance as number
          )
        })
      }
      if (expected.position) {
        const dist = Math.hypot(
          result.position[0] - expected.position[0],
          result.position[1] - expected.position[1]
        )
        expect(dist).toBeLessThanOrEqual(expected.positionTolerance as number)
      }
    })
  }
})

// ---------------------------------------------------------------------------
// Property-style edge cases (TS-only; seeded, deterministic).
// ---------------------------------------------------------------------------

/** mulberry32 — tiny deterministic PRNG, good enough for property tests. */
function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function checkInvariants(chain: IkChain, result: IkResult, target: [number, number]): void {
  // Angles always normalised and inside limits.
  result.angles.forEach((a, i) => {
    expect(a).toBeGreaterThanOrEqual(-Math.PI - LIMIT_SLACK)
    expect(a).toBeLessThan(Math.PI + LIMIT_SLACK)
    const lim = chain.limits?.[i]
    if (lim) {
      expect(a).toBeGreaterThanOrEqual(lim[0] - LIMIT_SLACK)
      expect(a).toBeLessThanOrEqual(lim[1] + LIMIT_SLACK)
    }
  })
  // position/error are consistent with the returned angles.
  const [x, y] = forwardKinematics(chain.boneLengths, result.angles)
  expect(result.position[0]).toBeCloseTo(x, 9)
  expect(result.position[1]).toBeCloseTo(y, 9)
  expect(result.error).toBeCloseTo(Math.hypot(x - target[0], y - target[1]), 9)
}

describe('solveIk — property-style edge cases (#538)', () => {
  it('2-bone: any target inside the annulus of an unconstrained arm is reached', () => {
    const rand = rng(538)
    for (let trial = 0; trial < 250; trial++) {
      const L1 = 0.5 + rand() * 2
      const L2 = 0.5 + rand() * 2
      const inner = Math.abs(L1 - L2)
      const outer = L1 + L2
      const d = inner + (0.02 + 0.96 * rand()) * (outer - inner)
      const theta = (rand() * 2 - 1) * Math.PI
      const target: [number, number] = [d * Math.cos(theta), d * Math.sin(theta)]
      const chain: IkChain = { boneLengths: [L1, L2] }
      const result = solveIk(chain, target)
      expect(result.status).toBe('reached')
      checkInvariants(chain, result, target)
    }
  })

  it('2-bone: both elbow configurations solve the same target (seeded by current pose)', () => {
    const chain: IkChain = { boneLengths: [1.2, 0.9] }
    const target: [number, number] = [1.0, 0.9]
    const up = solveIk(chain, target, { currentAngles: [0, 1] })
    const down = solveIk(chain, target, { currentAngles: [1.4, -1] })
    expect(up.status).toBe('reached')
    expect(down.status).toBe('reached')
    // Genuinely different configurations, same effector position.
    expect(Math.sign(up.angles[1])).not.toBe(Math.sign(down.angles[1]))
    expect(up.position[0]).toBeCloseTo(down.position[0], 6)
    expect(up.position[1]).toBeCloseTo(down.position[1], 6)
  })

  it('FABRIK: random unconstrained 3–5 bone chains reach random interior targets', () => {
    const rand = rng(1234)
    for (let trial = 0; trial < 120; trial++) {
      const n = 3 + Math.floor(rand() * 3)
      const lengths = Array.from({ length: n }, () => 0.3 + rand() * 1.2)
      const total = lengths.reduce((s, l) => s + l, 0)
      // Interior targets away from the slow-convergence boundary ring.
      const d = (0.15 + 0.7 * rand()) * total
      const theta = (rand() * 2 - 1) * Math.PI
      const target: [number, number] = [d * Math.cos(theta), d * Math.sin(theta)]
      const chain: IkChain = { boneLengths: lengths }
      const result = solveIk(chain, target, { tolerance: 1e-3 })
      expect(result.status).toBe('reached')
      checkInvariants(chain, result, target)
    }
  })

  it('random limited chains NEVER return an angle outside its limits, whatever the status', () => {
    const rand = rng(42)
    for (let trial = 0; trial < 200; trial++) {
      const n = 1 + Math.floor(rand() * 4)
      const lengths = Array.from({ length: n }, () => 0.3 + rand() * 1.2)
      const limits: JointLimit[] = Array.from({ length: n }, () => {
        const lo = -Math.PI * rand()
        const hi = Math.PI * rand()
        return [lo, hi]
      })
      const currentAngles = limits.map(([lo, hi]) => lo + rand() * (hi - lo))
      const target: [number, number] = [(rand() * 2 - 1) * 4, (rand() * 2 - 1) * 4]
      const chain: IkChain = { boneLengths: lengths, limits }
      const result = solveIk(chain, target, { currentAngles })
      checkInvariants(chain, result, target)
      expect(['reached', 'out_of_reach', 'blocked_by_limits']).toContain(result.status)
    }
  })

  it('out_of_reach is reported for any target beyond the total length', () => {
    const rand = rng(9001)
    for (let trial = 0; trial < 100; trial++) {
      const n = 1 + Math.floor(rand() * 4)
      const lengths = Array.from({ length: n }, () => 0.3 + rand() * 1.2)
      const total = lengths.reduce((s, l) => s + l, 0)
      const d = total * (1.01 + rand() * 3)
      const theta = (rand() * 2 - 1) * Math.PI
      const target: [number, number] = [d * Math.cos(theta), d * Math.sin(theta)]
      const chain: IkChain = { boneLengths: lengths }
      const result = solveIk(chain, target)
      expect(result.status).toBe('out_of_reach')
      checkInvariants(chain, result, target)
      // Best effort: unconstrained chains end up fully stretched at the rim.
      expect(Math.hypot(result.position[0], result.position[1])).toBeCloseTo(total, 6)
    }
  })

  it('a solve seeded with the answer returns it unchanged (idempotence)', () => {
    const chain: IkChain = { boneLengths: [1, 0.7, 0.5] }
    const first = solveIk(chain, [1.1, 0.9], { tolerance: 1e-6 })
    expect(first.status).toBe('reached')
    const again = solveIk(chain, [1.1, 0.9], { currentAngles: first.angles, tolerance: 1e-6 })
    expect(again.status).toBe('reached')
    expect(again.iterations).toBe(0)
    again.angles.forEach((a, i) => expect(a).toBeCloseTo(first.angles[i], 12))
  })

  it('guards: zero-length, negative, empty and mismatched inputs throw stable codes', () => {
    expect(() => solveIk({ boneLengths: [] }, [1, 0])).toThrowError('invalid_chain')
    expect(() => solveIk({ boneLengths: [1, 0] }, [1, 0])).toThrowError('invalid_bone_length')
    expect(() => solveIk({ boneLengths: [1, -2] }, [1, 0])).toThrowError('invalid_bone_length')
    expect(() => solveIk({ boneLengths: [1, NaN] }, [1, 0])).toThrowError('invalid_bone_length')
    expect(() => solveIk({ boneLengths: [1], limits: [] }, [1, 0])).toThrowError('invalid_limits')
    expect(() =>
      solveIk({ boneLengths: [1], limits: [[2, -2]] }, [1, 0])
    ).toThrowError('invalid_limits')
    expect(() =>
      solveIk({ boneLengths: [1], limits: [[-4, 4]] }, [1, 0])
    ).toThrowError('invalid_limits')
    expect(() => solveIk({ boneLengths: [1] }, [1, 0], { currentAngles: [0, 0] })).toThrowError(
      'invalid_angles'
    )
  })

  it('pinned joints (min === max) are honoured exactly', () => {
    const chain: IkChain = {
      boneLengths: [1, 1, 1],
      limits: [
        [0.4, 0.4],
        [-Math.PI, Math.PI],
        [-Math.PI, Math.PI]
      ]
    }
    const result = solveIk(chain, [0.5, 1.5], { tolerance: 1e-3 })
    expect(result.angles[0]).toBe(0.4)
    expect(result.status).toBe('reached')
  })
})
