import { describe, it, expect } from 'vitest'
import {
  ROBOT_HISTORY_LIMIT,
  commitRobot,
  documentSignature,
  foldLive,
  keepPartLinks,
  redoRobot,
  robotSignature,
  sameDocument,
  sameRobot,
  undoRobot
} from '../src/renderer/src/components/robot-history'
import { historyInit } from '../src/renderer/src/components/use-history'
import { blankRobot, type RobotDefinition } from '../src/shared/robot'
import { robotFromYaml, robotToYaml } from '../src/shared/robot-yaml'

/** A document with `n` wires between the board and an LED (enough to tell two
 *  checkpoints apart). */
const doc = (n: number): RobotDefinition => ({
  ...blankRobot(),
  board: 'pico2w',
  parts: [{ id: 'led1', lib: 'basics', part: 'led', x: 10, y: 20 }],
  connections: Array.from({ length: n }, (_, i) => ({
    id: `w${i}`,
    from: `board.GP${i}`,
    to: 'led1.A',
    net: 'signal' as const
  }))
})

/** What the round trip through robot.yml gives back — a NEW object holding the
 *  same document, which is what every save hands this window via `didChange`. */
const reparsed = (d: RobotDefinition): RobotDefinition => robotFromYaml(robotToYaml(d))

describe('robotSignature / sameRobot', () => {
  it('is the document as robot.yml holds it', () => {
    expect(robotSignature(doc(1))).toBe(robotToYaml(doc(1)))
  })

  it('sees a re-parse of the same document as unchanged', () => {
    const d = doc(2)
    expect(reparsed(d)).not.toBe(d) // a different object…
    expect(sameRobot(d, reparsed(d))).toBe(true) // …holding the same wiring
  })

  it('sees a real edit as changed', () => {
    expect(sameRobot(doc(1), doc(2))).toBe(false)
  })
})

describe('documentSignature / sameDocument', () => {
  const withLink = (d: RobotDefinition): RobotDefinition => ({
    ...d,
    parts: d.parts.map((p) => ({ ...p, urdfLink: `${p.id}_link` }))
  })

  it('ignores the urdfLink MAIN stamps back after a part is added', () => {
    const d = doc(1)
    expect(sameRobot(d, withLink(d))).toBe(false) // the FILE did change…
    expect(sameDocument(d, withLink(d))).toBe(true) // …but the learner didn't edit
    expect(documentSignature(withLink(d))).toBe(documentSignature(d))
  })

  it('still sees an edit made alongside the stamp', () => {
    expect(sameDocument(doc(1), withLink(doc(2)))).toBe(false)
  })
})

describe('keepPartLinks', () => {
  const live: RobotDefinition = {
    ...doc(1),
    parts: [
      { id: 'led1', lib: 'basics', part: 'led', urdfLink: 'led1_link' },
      { id: 'srv1', lib: 'basics', part: 'servo', urdfLink: 'srv1_link' }
    ]
  }

  it('carries a live Build link onto a restored part that has none', () => {
    const restored = { ...doc(1), parts: [{ id: 'led1', lib: 'basics', part: 'led' }] }
    expect(keepPartLinks(restored, live).parts[0].urdfLink).toBe('led1_link')
  })

  it('leaves a restored part that names its own link alone', () => {
    const restored = {
      ...doc(1),
      parts: [{ id: 'led1', lib: 'basics', part: 'led', urdfLink: 'other_link' }]
    }
    expect(keepPartLinks(restored, live).parts[0].urdfLink).toBe('other_link')
  })

  it('does not resurrect a part the restore does not have', () => {
    const restored = { ...doc(1), parts: [] }
    expect(keepPartLinks(restored, live).parts).toEqual([])
  })

  it('returns the same object when there is nothing to carry', () => {
    const restored = doc(1)
    expect(keepPartLinks(restored, doc(1))).toBe(restored)
  })
})

describe('foldLive', () => {
  it('leaves the stack alone when the live document is the present', () => {
    const h = historyInit(doc(1))
    expect(foldLive(h, h.present)).toBe(h)
  })

  it('adopts a re-parse of our own save WITHOUT a checkpoint, keeping redo', () => {
    const h = { past: [doc(1)], present: doc(2), future: [doc(3)] }
    const folded = foldLive(h, reparsed(doc(2)))
    expect(folded.past).toEqual(h.past)
    expect(folded.future).toEqual(h.future) // a reload must not kill redo
    expect(sameRobot(folded.present, doc(2))).toBe(true)
  })

  it('check-points a genuine out-of-band edit, and drops the stale redo', () => {
    const h = { past: [doc(1)], present: doc(2), future: [doc(3)] }
    const folded = foldLive(h, doc(4))
    expect(folded.past).toEqual([doc(1), doc(2)])
    expect(folded.present).toEqual(doc(4))
    expect(folded.future).toEqual([])
  })
})

describe('commitRobot', () => {
  it('takes one step per action', () => {
    let h = historyInit(doc(0))
    h = commitRobot(h, doc(0), doc(1))
    h = commitRobot(h, doc(1), doc(2))
    expect(h.past).toEqual([doc(0), doc(1)])
    expect(h.present).toEqual(doc(2))
  })

  it('takes no step for a save that changes nothing', () => {
    const h = commitRobot(historyInit(doc(1)), doc(1), reparsed(doc(1)))
    expect(h.past).toEqual([])
  })

  it('folds the save/reload round trip in without a spurious step', () => {
    // What actually happens in the app: commit → save → robot:didChange → the
    // file is re-read → the NEXT commit sees a re-parsed live document.
    let h = historyInit(doc(0))
    h = commitRobot(h, doc(0), doc(1))
    h = commitRobot(h, reparsed(doc(1)), doc(2))
    expect(h.past).toEqual([doc(0), doc(1)])
    // One undo per action — not one per action plus one per reload.
    const back = undoRobot(h, reparsed(doc(2)))
    expect(sameRobot(back.present, doc(1))).toBe(true)
  })

  it('caps the stack at the limit', () => {
    let h = historyInit(doc(0))
    for (let i = 1; i <= ROBOT_HISTORY_LIMIT + 10; i++) h = commitRobot(h, doc(i - 1), doc(i))
    expect(h.past).toHaveLength(ROBOT_HISTORY_LIMIT)
  })
})

describe('undoRobot / redoRobot', () => {
  it('walks back and forward through the edits', () => {
    let h = historyInit(doc(0))
    h = commitRobot(h, doc(0), doc(1))
    h = commitRobot(h, doc(1), doc(2))
    h = undoRobot(h, doc(2))
    expect(h.present).toEqual(doc(1))
    h = undoRobot(h, doc(1))
    expect(h.present).toEqual(doc(0))
    h = redoRobot(h, doc(0))
    expect(h.present).toEqual(doc(1))
  })

  it('survives the reload each undo triggers (undo ⇄ redo keeps working)', () => {
    let h = historyInit(doc(0))
    h = commitRobot(h, doc(0), doc(1))
    h = undoRobot(h, reparsed(doc(1)))
    expect(sameRobot(h.present, doc(0))).toBe(true)
    h = redoRobot(h, reparsed(doc(0)))
    expect(sameRobot(h.present, doc(1))).toBe(true)
  })

  it('is a no-op at each end of the stack', () => {
    const empty = historyInit(doc(1))
    expect(undoRobot(empty, empty.present)).toBe(empty)
    expect(redoRobot(empty, empty.present)).toBe(empty)
    // …and with a reloaded document too: nothing to step to, nothing recorded.
    const reloaded = undoRobot(empty, reparsed(doc(1)))
    expect(reloaded.past).toEqual([])
    expect(reloaded.future).toEqual([])
    expect(sameRobot(reloaded.present, doc(1))).toBe(true)
  })

  it('keeps a part Build link the undo target predates', () => {
    const before = doc(1)
    const added: RobotDefinition = {
      ...before,
      parts: [...before.parts, { id: 'srv1', lib: 'basics', part: 'servo' }]
    }
    // MAIN stamps the new part's Build body in after the add.
    const stamped: RobotDefinition = {
      ...added,
      parts: added.parts.map((p) => (p.id === 'srv1' ? { ...p, urdfLink: 'srv1_link' } : p))
    }
    let h = commitRobot(historyInit(before), before, added)
    h = commitRobot(h, stamped, { ...stamped, connections: doc(2).connections })
    // One undo per action: the stamp is not one of them.
    h = undoRobot(h, { ...stamped, connections: doc(2).connections })
    expect(h.present.connections).toHaveLength(1)
    expect(h.present.parts.find((p) => p.id === 'srv1')?.urdfLink).toBe('srv1_link')
  })
})
