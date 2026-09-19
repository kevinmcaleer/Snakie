/**
 * ELECTRONICS UNDO/REDO — the wiring document's history.
 * =============================================================================
 *
 * The Electronics view edits ONE document: the project's `robot.yml` (the board,
 * the placed parts and every wire between them). Every action in it — drop a
 * part, drag it, wire two pins, recolour or delete a wire, rotate, rename,
 * duplicate, swap the board — funnels through the host's single "save the robot"
 * call, so checkpointing the document there gives undo over ALL of them. These
 * are the pure steps of that; {@link ./BoardPane} holds the stack and applies the
 * present. They reuse the #187 history primitives ({@link ./use-history}) that
 * the Part Editor and the Build view's undo (#338) are built on.
 *
 * Two things make this document different from the Build view's URDF text, and
 * both are handled here rather than at the call sites:
 *
 * 1. **It comes back from disk.** Every save echoes `robot:didChange` to its own
 *    window, which re-reads and re-parses the file — so the live document is a
 *    NEW object after each edit, holding the same wiring. Identity comparison
 *    would checkpoint that round trip and make Ctrl+Z step through no-ops, so
 *    "has it changed?" is asked of the canonical YAML, exactly what the file
 *    holds ({@link robotSignature}). A re-parse of what we just saved is adopted
 *    as the present WITHOUT a checkpoint, and without dropping the redo stack.
 *
 * 2. **MAIN writes one field back.** After a part is added, `robot:patchPartLinks`
 *    stamps each part's `urdfLink` (the Build body it got) into the file. That is
 *    bookkeeping, not an edit the learner made: it must not cost an undo step
 *    ({@link documentSignature} ignores it), and an undo must not strip it back
 *    off and orphan the Build body ({@link keepPartLinks} carries it forward onto
 *    whatever the undo restores).
 *
 * Anything else that changes the file underneath us — the other Board View
 * window, the Electronics ⇄ Build reconcile — IS a real edit, and is folded in as
 * a checkpoint of its own the next time the user reaches for undo.
 */
import { robotToYaml } from '../../../shared/robot-yaml'
import type { RobotDefinition } from '../../../shared/robot'
import {
  canRedo,
  canUndo,
  historyPush,
  historyRedo,
  historyUndo,
  type History
} from './use-history'

/** Checkpoints kept per project — deep enough to walk back a wiring session,
 *  shallow enough that a whole document per step stays cheap. */
export const ROBOT_HISTORY_LIMIT = 50

/** The document as `robot.yml` would hold it: the only differences that matter,
 *  since the file IS the document. Falls back to JSON if serialisation throws,
 *  so a history compare can never break an edit. */
export function robotSignature(def: RobotDefinition): string {
  try {
    return robotToYaml(def)
  } catch {
    return JSON.stringify(def)
  }
}

/** Same document, byte for byte, once written out. */
export function sameRobot(a: RobotDefinition, b: RobotDefinition): boolean {
  return a === b || robotSignature(a) === robotSignature(b)
}

/** The signature WITHOUT the Build bookkeeping MAIN stamps back (see the header):
 *  what the learner would call a change. */
export function documentSignature(def: RobotDefinition): string {
  const parts = def.parts ?? []
  if (!parts.some((p) => p.urdfLink)) return robotSignature(def)
  return robotSignature({
    ...def,
    parts: parts.map((p) => {
      if (!p.urdfLink) return p
      const bare = { ...p }
      delete bare.urdfLink
      return bare
    })
  })
}

/** Whether `next` differs from `prev` in anything the learner did. */
export function sameDocument(prev: RobotDefinition, next: RobotDefinition): boolean {
  return prev === next || documentSignature(prev) === documentSignature(next)
}

/**
 * Carry each part's `urdfLink` from the LIVE document onto a restored one, so
 * stepping back past the moment a part's Build body landed doesn't orphan that
 * body. Only fills a blank: a snapshot that names its own link keeps it, and a
 * part the restore doesn't have is not resurrected.
 */
export function keepPartLinks(target: RobotDefinition, live: RobotDefinition): RobotDefinition {
  const links = new Map((live.parts ?? []).filter((p) => p.urdfLink).map((p) => [p.id, p.urdfLink]))
  if (links.size === 0) return target
  let touched = false
  const parts = (target.parts ?? []).map((p) => {
    const link = p.urdfLink ? undefined : links.get(p.id)
    if (!link) return p
    touched = true
    return { ...p, urdfLink: link }
  })
  return touched ? { ...target, parts } : target
}

/**
 * Bring the stack's present up to the LIVE document before acting on it.
 *
 * A re-parse of our own save (or MAIN's `urdfLink` stamp) is adopted in place —
 * no checkpoint, and crucially no loss of the redo stack, or a Ctrl+Z ⇄ Ctrl+⇧Z
 * pair would break on the reload its own undo triggered. A genuine out-of-band
 * edit (the other board window, the Build reconcile) becomes a checkpoint of its
 * own, which — like any undo manager — clears the redo stack, so a later Redo
 * can't drop a stale future on top of it.
 */
export function foldLive(
  h: History<RobotDefinition>,
  live: RobotDefinition,
  limit = ROBOT_HISTORY_LIMIT
): History<RobotDefinition> {
  if (h.present === live) return h
  if (sameDocument(h.present, live)) return { past: h.past, present: live, future: h.future }
  return historyPush(h, live, limit)
}

/** Check-point the live document and make `next` the present — one undo step per
 *  action. A save that changes nothing takes no step. */
export function commitRobot(
  h: History<RobotDefinition>,
  live: RobotDefinition,
  next: RobotDefinition,
  limit = ROBOT_HISTORY_LIMIT
): History<RobotDefinition> {
  const folded = foldLive(h, live, limit)
  if (sameRobot(folded.present, next)) return { ...folded, present: next }
  return historyPush(folded, next, limit)
}

/** Step back one checkpoint (no-op when there's nothing to undo). */
export function undoRobot(
  h: History<RobotDefinition>,
  live: RobotDefinition,
  limit = ROBOT_HISTORY_LIMIT
): History<RobotDefinition> {
  const folded = foldLive(h, live, limit)
  if (!canUndo(folded)) return folded
  const stepped = historyUndo(folded)
  return { ...stepped, present: keepPartLinks(stepped.present, live) }
}

/** Step forward one checkpoint (no-op when there's nothing to redo). */
export function redoRobot(
  h: History<RobotDefinition>,
  live: RobotDefinition,
  limit = ROBOT_HISTORY_LIMIT
): History<RobotDefinition> {
  const folded = foldLive(h, live, limit)
  if (!canRedo(folded)) return folded
  const stepped = historyRedo(folded)
  return { ...stepped, present: keepPartLinks(stepped.present, live) }
}
