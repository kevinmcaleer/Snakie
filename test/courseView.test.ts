import { describe, expect, it } from 'vitest'
import { coerceView } from '../src/renderer/src/lib/courses'

describe('coerceView (#483 — a lesson declares the workspace it is about)', () => {
  it('accepts the layout ids', () => {
    expect(coerceView('code')).toBe('code')
    expect(coerceView('board')).toBe('board')
    expect(coerceView('robot')).toBe('robot')
  })

  it('accepts the names the UI actually shows', () => {
    // Course YAML is hand-authored; the UI says Electronics and Build while the
    // layout ids are `board` and `robot`. Rejecting the visible names would be a
    // trap for whoever writes the next course.
    expect(coerceView('Electronics')).toBe('board')
    expect(coerceView('breadboard')).toBe('board')
    expect(coerceView('Build')).toBe('robot')
    expect(coerceView('urdf')).toBe('robot')
    expect(coerceView('3D')).toBe('robot')
    expect(coerceView('editor')).toBe('code')
  })

  it('is undefined for absent or unknown values, so the course still loads', () => {
    // A typo must degrade to "don't switch", never throw the course away.
    for (const bad of ['', '   ', 'board-view', 'nonsense', null, undefined, 3, {}]) {
      expect(coerceView(bad), String(bad)).toBeUndefined()
    }
  })
})

describe('bundled courses', () => {
  it('declares the Build workspace on every URDF lesson', async () => {
    // That course is entirely about the 3-D view; opening it in the code editor
    // leaves the reader hunting for what the words describe.
    const { loadCourses } = await import('../src/renderer/src/lib/courses')
    const urdf = loadCourses().find((c) => c.id === 'urdf')
    expect(urdf, 'the urdf course is bundled').toBeTruthy()
    expect(urdf!.lessons.length).toBeGreaterThan(0)
    for (const l of urdf!.lessons) expect(l.view, l.title).toBe('robot')
  })

  it('sends the board-view lesson to Electronics', async () => {
    const { loadCourses } = await import('../src/renderer/src/lib/courses')
    const robotics = loadCourses().find((c) => c.id === 'robotics')
    const lesson = robotics?.lessons.find((l) => l.title === 'See your board')
    expect(lesson?.view).toBe('board')
  })

  it('leaves plain code lessons alone', async () => {
    const { loadCourses } = await import('../src/renderer/src/lib/courses')
    const beginner = loadCourses().find((c) => c.id === 'beginner')
    expect(beginner!.lessons.every((l) => l.view === undefined)).toBe(true)
  })
})
