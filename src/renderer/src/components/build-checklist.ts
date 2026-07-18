/**
 * ROBOT BUILD CHECKLIST (#436) — pure detection logic for the Learn panel's
 * "Build a robot" completion checklist.
 * =============================================================================
 *
 * Eight steps walk a maker from an empty project to a simulated, animated
 * robot. Six are LIVE-detected from project state (the `robot.yml` definition +
 * the linked URDF text + the parts library), so they tick themselves as the
 * build progresses and un-tick if the thing is removed. The last two ("write
 * the app", "run it on the simulator") are OBSERVED: we latch them ON when we
 * see the evidence (an open Python file that drives servos; a connection to the
 * Simulated device) and remember that per-project, with a manual checkbox as
 * the fallback.
 *
 * Dependency-light (shared types + the pure `servo-bind` helpers only) so the
 * detection functions unit-test in node — see `test/buildChecklist.test.ts`.
 */
import type { PartDefinition } from '../../../shared/part'
import type { RobotDefinition } from '../../../shared/robot'
import { isServoPart } from './servo-bind'

/** The checklist step ids, in build order. */
export type BuildStepId =
  | 'board'
  | 'servos'
  | 'meshes'
  | 'joints'
  | 'bind'
  | 'poses'
  | 'code'
  | 'simulate'

export interface BuildStepDef {
  id: BuildStepId
  /** Short row title. */
  title: string
  /** One line of child-friendly guidance. */
  hint: string
  /** The panel/surface where this step happens (shown as a chip). */
  where: string
  /**
   * 'live'     — recomputed from project state on every change (no checkbox).
   * 'observed' — latched ON when detected, with a manual checkbox fallback.
   */
  mode: 'live' | 'observed'
}

/** The eight steps of the robot build, in order (issue #436). */
export const BUILD_STEPS: readonly BuildStepDef[] = [
  {
    id: 'board',
    title: 'Pick your board',
    hint: 'Choose the brain of your robot (like a Pico) on the breadboard.',
    where: 'Board View',
    mode: 'live'
  },
  {
    id: 'servos',
    title: 'Add a servo',
    hint: 'Drag a servo (like the SG90) onto the breadboard from the parts list.',
    where: 'Board View · Parts',
    mode: 'live'
  },
  {
    id: 'meshes',
    title: 'Import a 3-D shape',
    hint: 'Give your robot a body — import an STL file into the Robot View.',
    where: 'Robot View',
    mode: 'live'
  },
  {
    id: 'joints',
    title: 'Create a joint',
    hint: 'Join two parts so one can move — pick two faces and add a joint.',
    where: 'Robot View · Build',
    mode: 'live'
  },
  {
    id: 'bind',
    title: 'Connect a servo to a joint',
    hint: 'Tell Snakie which servo moves which joint, so wires and 3-D match up.',
    where: 'Robot View · Bind servo',
    mode: 'live'
  },
  {
    id: 'poses',
    title: 'Save some poses',
    hint: 'Slide the joints until your robot looks cool, then save the pose with a name.',
    where: 'Motion Studio · Poses',
    mode: 'live'
  },
  {
    id: 'code',
    title: 'Write your robot app',
    hint: 'Make a Python file that moves your servos — try exporting your poses to code.',
    where: 'Editor',
    mode: 'observed'
  },
  {
    id: 'simulate',
    title: 'Run it on the simulator',
    hint: 'Connect the Simulated device and press Run — no hardware needed!',
    where: 'Port menu · Simulated device',
    mode: 'observed'
  }
]

/** Everything the detectors read — a cheap snapshot of live project state. */
export interface BuildSnapshot {
  /** The project's robot.yml definition (parts, wires, robot model). */
  def?: RobotDefinition | null
  /** The linked URDF's text (open editor buffer preferred, else disk). */
  urdfText?: string | null
  /** Lowercased `"<lib>/<part>"` keys of library parts known to be servos. */
  servoPartKeys?: ReadonlySet<string>
  /** Open editor Python files (name + live content), for app detection. */
  openPython?: readonly { name: string; content: string }[]
  /** True while connected to the Simulated device (`snakie://virtual`). */
  simulatorConnected?: boolean
}

/** Lowercased `"<lib>/<part>"` keys for every servo part across libraries. */
export function servoPartKeysOf(
  libraries: readonly { id: string; parts: readonly PartDefinition[] }[]
): Set<string> {
  const keys = new Set<string>()
  for (const lib of libraries) {
    for (const p of lib.parts) {
      if (isServoPart(p)) keys.add(`${lib.id}/${p.id}`.toLowerCase())
    }
  }
  return keys
}

/** Count the named `<joint …>` elements in a URDF document. */
export function countUrdfJoints(urdf: string): number {
  return (urdf.match(/<joint\b[^>]*\bname\s*=/gi) ?? []).length
}

/** Whether the URDF references at least one mesh file (an imported STL/DAE/OBJ). */
export function urdfHasMesh(urdf: string): boolean {
  return /<mesh\b[^>]*\bfilename\s*=\s*"[^"]+"/i.test(urdf)
}

/** Heuristic: an open Python file that looks like it animates the robot. */
export function looksLikeRobotApp(name: string, content: string): boolean {
  if (!/\.py$/i.test(name)) return false
  return /\bservo\b|SNAKIE_POSES|SNAKIE_SEQUENCES/i.test(content)
}

/** Whether a placed robot.yml part is a servo — library lookup, then a name match. */
function placedPartIsServo(
  part: { lib: string; part: string; label?: string },
  servoPartKeys: ReadonlySet<string> | undefined
): boolean {
  if (servoPartKeys?.has(`${part.lib}/${part.part}`.toLowerCase())) return true
  // Fallback when the library isn't loaded (e.g. detached/web): match the id/label.
  return /servo|sg90/i.test(`${part.part} ${part.label ?? ''}`)
}

/** Run every step's detector over the snapshot. Pure. */
export function detectSteps(snap: BuildSnapshot): Record<BuildStepId, boolean> {
  const def = snap.def ?? null
  const urdf = snap.urdfText ?? ''
  return {
    board: Boolean(def?.board),
    servos: (def?.parts ?? []).some((p) => placedPartIsServo(p, snap.servoPartKeys)),
    meshes: urdf ? urdfHasMesh(urdf) : false,
    joints: urdf ? countUrdfJoints(urdf) > 0 : false,
    bind: (def?.robot?.servoJointMap ?? []).some((b) => Boolean(b.pin && b.joint)),
    poses: (def?.robot?.poses ?? []).length > 0,
    code: (snap.openPython ?? []).some((f) => looksLikeRobotApp(f.name, f.content)),
    simulate: snap.simulatorConnected === true
  }
}

/** Per-project remembered state: which OBSERVED steps have been achieved. */
export type StickyRecord = Partial<Record<BuildStepId, boolean>>

/**
 * Latch newly-observed steps into the sticky record. Returns the SAME reference
 * when nothing changed (so callers can persist/set-state only on real change).
 */
export function latchSticky(
  detected: Record<BuildStepId, boolean>,
  sticky: StickyRecord
): StickyRecord {
  let next: StickyRecord | null = null
  for (const step of BUILD_STEPS) {
    if (step.mode === 'observed' && detected[step.id] && !sticky[step.id]) {
      next = next ?? { ...sticky }
      next[step.id] = true
    }
  }
  return next ?? sticky
}

/** One resolved checklist row. */
export interface BuildStepState {
  step: BuildStepDef
  /** The step counts as complete (live detection, or the sticky/manual tick). */
  done: boolean
  /** What the detector said right now (drives the latch). */
  detected: boolean
}

/** Combine live detection + the sticky record into the rendered rows. Pure. */
export function resolveChecklist(
  detected: Record<BuildStepId, boolean>,
  sticky: StickyRecord
): BuildStepState[] {
  return BUILD_STEPS.map((step) => ({
    step,
    detected: detected[step.id],
    done: detected[step.id] || (step.mode === 'observed' && sticky[step.id] === true)
  }))
}

/** Progress summary for the header ("3 / 8"). */
export function checklistProgress(items: readonly BuildStepState[]): { done: number; total: number } {
  return { done: items.filter((i) => i.done).length, total: items.length }
}

// ── Per-project persistence (localStorage, keyed by the project folder) ──────

/** Minimal storage shape (mirrors the session-restore store's StorageLike). */
export interface ChecklistStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

const KEY_PREFIX = 'snakie.buildChecklist.v1'

/** The storage key for a project folder (a keyless scratch bucket when none). */
export function checklistKey(folder: string | null | undefined): string {
  return folder ? `${KEY_PREFIX}:${folder}` : KEY_PREFIX
}

/** Load the per-project sticky record ({} on missing/corrupt storage). */
export function loadSticky(storage: ChecklistStorage, folder: string | null | undefined): StickyRecord {
  try {
    const raw = storage.getItem(checklistKey(folder))
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    const out: StickyRecord = {}
    for (const step of BUILD_STEPS) {
      if ((parsed as Record<string, unknown>)[step.id] === true) out[step.id] = true
    }
    return out
  } catch {
    return {}
  }
}

/** Persist the sticky record (best-effort — storage may be unavailable). */
export function saveSticky(
  storage: ChecklistStorage,
  folder: string | null | undefined,
  sticky: StickyRecord
): void {
  try {
    storage.setItem(checklistKey(folder), JSON.stringify(sticky))
  } catch {
    /* best-effort — a checklist tick not persisting is non-fatal */
  }
}
