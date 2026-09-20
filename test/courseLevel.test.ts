import { describe, expect, it } from 'vitest'
import {
  coerceLevel,
  lessonLevel,
  loadCourses,
  shouldRaiseBlockLevel,
  type Course,
  type Lesson
} from '../src/renderer/src/lib/courses'

const course = (over: Partial<Course> = {}): Course => ({
  id: 'x',
  title: 'X',
  description: '',
  emoji: '📘',
  accent: '#000',
  track: 'beginner',
  lessons: [],
  ...over
})
const lesson = (over: Partial<Lesson> = {}): Lesson => ({ title: 'L', body: '', ...over })

describe('coerceLevel (#1214 — a course declares the blocks level it needs)', () => {
  it('accepts the registry levels and the words an author might write', () => {
    expect(coerceLevel('advanced')).toBe('advanced')
    expect(coerceLevel(' Advanced ')).toBe('advanced')
    expect(coerceLevel('expert')).toBe('advanced')
    expect(coerceLevel('simple')).toBe('simple')
    expect(coerceLevel('beginner')).toBe('simple')
  })

  it('is undefined for absent or unknown values, so the course still loads', () => {
    for (const bad of ['', '  ', 'hard', 'advance', null, undefined, 2, {}]) {
      expect(coerceLevel(bad), String(bad)).toBeUndefined()
    }
  })
})

describe('lessonLevel', () => {
  it('prefers the lesson, falls back to the course, else nothing', () => {
    expect(lessonLevel(course({ level: 'simple' }), lesson({ level: 'advanced' }))).toBe('advanced')
    expect(lessonLevel(course({ level: 'advanced' }), lesson())).toBe('advanced')
    expect(lessonLevel(course(), lesson())).toBeUndefined()
  })
})

describe('shouldRaiseBlockLevel', () => {
  it('raises a simple learner into advanced when the lesson asks', () => {
    expect(shouldRaiseBlockLevel('advanced', 'simple')).toBe(true)
  })

  it('never lowers, and never fires for a course that declares nothing', () => {
    // Leaving an advanced lesson must not put the drawers away again, and a
    // beginner course must not take them from someone who chose to have them.
    expect(shouldRaiseBlockLevel('simple', 'advanced')).toBe(false)
    expect(shouldRaiseBlockLevel(undefined, 'advanced')).toBe(false)
    expect(shouldRaiseBlockLevel(undefined, 'simple')).toBe(false)
    expect(shouldRaiseBlockLevel('advanced', 'advanced')).toBe(false)
  })
})

describe('bundled courses', () => {
  it('declares advanced on the grey-Python-blocks lesson, and nowhere else', () => {
    const blocks = loadCourses().find((c) => c.id === 'blocks')
    expect(blocks, 'the blocks course is bundled').toBeTruthy()
    const greys = blocks!.lessons.find((l) => l.title.startsWith('When the block you need'))
    expect(greys?.level).toBe('advanced')
    // The rest of the on-ramp is beginner material and must stay silent.
    expect(blocks!.level).toBeUndefined()
    expect(blocks!.lessons.filter((l) => l.level === 'advanced')).toHaveLength(1)
  })

  it('leaves every other bundled course declaring nothing', () => {
    for (const c of loadCourses().filter((c) => c.id !== 'blocks')) {
      expect(c.level, c.id).toBeUndefined()
      for (const l of c.lessons) expect(l.level, `${c.id}/${l.title}`).toBeUndefined()
    }
  })

  it('exercises the raise the way opening that lesson does', () => {
    const blocks = loadCourses().find((c) => c.id === 'blocks')!
    const greys = blocks.lessons.find((l) => l.title.startsWith('When the block you need'))!
    expect(shouldRaiseBlockLevel(lessonLevel(blocks, greys), 'simple')).toBe(true)
    expect(shouldRaiseBlockLevel(lessonLevel(blocks, blocks.lessons[0]), 'simple')).toBe(false)
  })
})
