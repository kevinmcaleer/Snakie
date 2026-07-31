import { describe, expect, it } from 'vitest'
import { formatCourseLink, parseCourseLink, resolveLessonIndex } from '../src/renderer/src/lib/course-link'

describe('parseCourseLink', () => {
  it('reads a course link', () => {
    expect(parseCourseLink('#/learn/robotics')).toEqual({ courseId: 'robotics', lessonIndex: null })
  })

  it('reads a lesson link, converting 1-based URL to 0-based index', () => {
    // A link that says /3 must be the THIRD lesson, not the fourth.
    expect(parseCourseLink('#/learn/robotics/3')).toEqual({ courseId: 'robotics', lessonIndex: 2 })
    expect(parseCourseLink('#/learn/robotics/1')?.lessonIndex).toBe(0)
  })

  it('tolerates a missing hash and a trailing slash', () => {
    expect(parseCourseLink('/learn/robotics/2')?.lessonIndex).toBe(1)
    expect(parseCourseLink('#/learn/robotics/')).toEqual({ courseId: 'robotics', lessonIndex: null })
  })

  it('decodes a percent-encoded id', () => {
    expect(parseCourseLink('#/learn/my%20course')?.courseId).toBe('my course')
  })

  it('is not fooled by a lone percent sign', () => {
    // A malformed escape shouldn't throw away an otherwise usable link.
    expect(parseCourseLink('#/learn/100%')?.courseId).toBe('100%')
  })

  it('falls back to the splash for a nonsense lesson rather than guessing', () => {
    for (const bad of ['0', '-2', 'x', '3x', '2.5', '']) {
      expect(parseCourseLink(`#/learn/robotics/${bad}`)?.lessonIndex, bad).toBeNull()
    }
  })

  it('rejects anything that is not a course link', () => {
    for (const bad of ['', '#', '#/settings', '#/learn/', '#/learn', 'nonsense', null, undefined]) {
      expect(parseCourseLink(bad as string), String(bad)).toBeNull()
    }
  })

  it('refuses a deeper path instead of guessing which part is the lesson', () => {
    expect(parseCourseLink('#/learn/robotics/2/extra')).toBeNull()
  })
})

describe('formatCourseLink', () => {
  it('round-trips through parse', () => {
    for (const [id, idx] of [['robotics', 0], ['urdf', 7], ['beginner', null]] as const) {
      const parsed = parseCourseLink(formatCourseLink(id, idx))
      expect(parsed).toEqual({ courseId: id, lessonIndex: idx })
    }
  })

  it('writes lessons 1-based', () => {
    expect(formatCourseLink('robotics', 0)).toBe('#/learn/robotics/1')
    expect(formatCourseLink('robotics', 2)).toBe('#/learn/robotics/3')
  })

  it('omits the lesson for a splash link', () => {
    expect(formatCourseLink('robotics')).toBe('#/learn/robotics')
    expect(formatCourseLink('robotics', null)).toBe('#/learn/robotics')
    expect(formatCourseLink('robotics', -1)).toBe('#/learn/robotics')
  })

  it('escapes an id with a space', () => {
    expect(formatCourseLink('my course')).toBe('#/learn/my%20course')
  })

  it('is empty for an empty id, rather than a broken link', () => {
    expect(formatCourseLink('')).toBe('')
    expect(formatCourseLink('   ')).toBe('')
  })
})

describe('resolveLessonIndex', () => {
  it('keeps an in-range lesson', () => {
    expect(resolveLessonIndex({ courseId: 'c', lessonIndex: 2 }, 5)).toBe(2)
  })

  it('clamps a link to a lesson the course no longer has', () => {
    // The user asked for THIS course; the end of it beats an error.
    expect(resolveLessonIndex({ courseId: 'c', lessonIndex: 9 }, 3)).toBe(2)
  })

  it('is null for a splash link, or a course with no lessons', () => {
    expect(resolveLessonIndex({ courseId: 'c', lessonIndex: null }, 5)).toBeNull()
    expect(resolveLessonIndex({ courseId: 'c', lessonIndex: 0 }, 0)).toBeNull()
  })
})
