import { describe, expect, it } from 'vitest'
import {
  isUrdfPath,
  resolveUrdfWriteTarget,
  type UrdfTargetFile,
  type UrdfWriteTarget
} from '../src/renderer/src/components/urdf-target'
import { safeUrdfName } from '../src/renderer/src/components/robot-part-mesh'

/**
 * THE #782 REGRESSION SUITE — a robot document may never land on a non-`.urdf`
 * path.
 *
 * The bug: the Build workspace mounts the full 3-D builder on the PROJECT urdf,
 * handed to it as text (`RobotDockPanel` → `RobotView urdfContent=…`), but the
 * builder persisted through `activeFile` — the focused editor tab. Its only
 * guard was "a saved local file", which a `main.py` passes, so the first drag in
 * Build replaced a user's program with `<robot name="my_robot">`, in the editor
 * and on disk.
 *
 * These tests are about the RULE, not the wiring: they assert the property that
 * NO input can produce a write target outside a `.urdf`, and that the specific
 * #782 shape resolves to a refusal rather than to the file that got destroyed.
 */

/** Every path a target could be asked to write, benign and hostile. */
const PATHS = [
  '/proj/robot.urdf',
  '/proj/nested/arm.URDF',
  '/proj/main.py',
  '/proj/robot.yml',
  '/proj/notes.urdf.py', // the extension is the LAST one, not any appearance
  '/proj/urdf', // a folder-ish name, not a document
  '/proj/robot.xacro',
  'robot.urdf',
  ''
]

const file = (path: string, over: Partial<UrdfTargetFile> = {}): UrdfTargetFile => ({
  id: 'f1',
  source: 'local',
  path,
  ...over
})

/** The path a target would write to, or null for a refusal. */
const targetPath = (t: UrdfWriteTarget): string | null => (t.kind === 'refuse' ? null : t.path)

describe('isUrdfPath — the one extension a robot document may be written to', () => {
  it('accepts a .urdf, any case, at any depth', () => {
    expect(isUrdfPath('robot.urdf')).toBe(true)
    expect(isUrdfPath('/proj/nested/arm.URDF')).toBe(true)
  })
  it('rejects everything else, including a .urdf that is not the last extension', () => {
    expect(isUrdfPath('/proj/main.py')).toBe(false)
    expect(isUrdfPath('/proj/notes.urdf.py')).toBe(false)
    expect(isUrdfPath('/proj/robot.xacro')).toBe(false)
    expect(isUrdfPath('')).toBe(false)
    expect(isUrdfPath(null)).toBe(false)
    expect(isUrdfPath(undefined)).toBe(false)
  })
})

describe('resolveUrdfWriteTarget — no input can aim a robot document at a non-.urdf', () => {
  // The property, over the whole cross-product of the two inputs: whatever the
  // view is showing and whatever tab is focused, a write either goes to a
  // `.urdf` or does not happen. Nothing here restates a branch — it asserts that
  // no combination escapes the rule.
  it('holds for every (document, active file) pair', () => {
    for (const documentPath of [...PATHS, null, undefined]) {
      for (const active of [
        null,
        ...PATHS.map((p) => file(p)),
        ...PATHS.map((p) => file(p, { source: 'device' }))
      ]) {
        const path = targetPath(resolveUrdfWriteTarget(documentPath, active))
        expect(path === null || isUrdfPath(path)).toBe(true)
      }
    }
  })

  it('THE #782 CASE: a handed-in document + a focused main.py refuses — it does not write the .py', () => {
    // Exactly the Build workspace: RobotView is showing the project URDF while
    // the user has their program open. Before the fix this resolved to the .py
    // buffer and the next builder action overwrote it.
    const target = resolveUrdfWriteTarget('/proj/robot.urdf', file('/proj/main.py'))
    expect(target).toEqual({ kind: 'file', path: '/proj/robot.urdf' })
  })

  it('a handed-in document that is NOT a .urdf refuses, and names the file it declined', () => {
    const target = resolveUrdfWriteTarget('/proj/main.py', file('/proj/robot.urdf'))
    expect(target.kind).toBe('refuse')
    // Refuses LOUDLY: the reason names the file so it can be surfaced, and it
    // never quietly falls through to the open .urdf, which would write the right
    // extension to the wrong robot.
    if (target.kind === 'refuse') expect(target.reason).toContain('main.py')
  })

  it('a document with no file of its own (the bundled demo arm) refuses rather than borrowing a tab', () => {
    expect(resolveUrdfWriteTarget(null, file('/proj/main.py')).kind).toBe('refuse')
    expect(resolveUrdfWriteTarget(null, file('/proj/robot.urdf'))).toEqual({
      kind: 'buffer',
      id: 'f1',
      path: '/proj/robot.urdf'
    })
  })

  it('with no handed-in document the open .urdf buffer is the target — and only a .urdf is', () => {
    expect(resolveUrdfWriteTarget(undefined, file('/proj/robot.urdf')).kind).toBe('buffer')
    expect(resolveUrdfWriteTarget(undefined, file('/proj/main.py')).kind).toBe('refuse')
    expect(resolveUrdfWriteTarget(undefined, file('', { path: '' })).kind).toBe('refuse')
    expect(resolveUrdfWriteTarget(undefined, file('/dev/main.py', { source: 'device' })).kind).toBe(
      'refuse'
    )
    expect(resolveUrdfWriteTarget(undefined, null).kind).toBe('refuse')
  })
})

describe('safeUrdfName — robot.yml cannot redirect the placement bridge off a .urdf (#782)', () => {
  it('refuses a robot.yml `urdf:` that names something other than a .urdf', () => {
    // `robot.urdf` is a LINK the user sets by picking a file, so its value is not
    // trusted to be a robot model. Before the fix this returned true and the
    // bridge would have appended part bodies straight into the named file.
    expect(safeUrdfName('main.py')).toBe(false)
    expect(safeUrdfName('code/main.py')).toBe(false)
    expect(safeUrdfName('robot.yml')).toBe(false)
    expect(safeUrdfName('robot')).toBe(false)
  })
  it('still accepts an in-project .urdf, and still refuses an escaping one', () => {
    expect(safeUrdfName('robot.urdf')).toBe(true)
    expect(safeUrdfName('robots/arm.urdf')).toBe(true)
    expect(safeUrdfName('../../evil.urdf')).toBe(false)
    expect(safeUrdfName('/etc/evil.urdf')).toBe(false)
  })
})
