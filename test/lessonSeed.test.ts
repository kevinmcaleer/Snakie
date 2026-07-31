import { describe, expect, it } from 'vitest'
import { lessonFileName, seedAction } from '../src/renderer/src/lib/lesson-seed'

describe('seedAction (#483 — never silently overwrite work)', () => {
  it('opens when nothing is there', () => {
    expect(seedAction({ starter: 'print(1)', existing: null })).toBe('open')
  })

  it('opens when the buffer still matches the starter', () => {
    expect(seedAction({ starter: 'print(1)', existing: 'print(1)' })).toBe('open')
  })

  it('asks before replacing work the user changed', () => {
    expect(seedAction({ starter: 'print(1)', existing: 'print(2)  # mine' })).toBe('confirm')
  })

  it('does not re-ask about a lesson already answered', () => {
    // Prompting on every revisit trains people to click through dialogs, which is
    // its own kind of data loss.
    expect(seedAction({ starter: 'print(1)', existing: 'mine', asked: true })).toBe('keep')
  })

  it('ignores editor whitespace noise', () => {
    // A trailing newline the editor added is not the user's work.
    expect(seedAction({ starter: 'print(1)', existing: 'print(1)\n' })).toBe('open')
    expect(seedAction({ starter: 'a\nb', existing: 'a  \nb\n\n' })).toBe('open')
    expect(seedAction({ starter: 'a\nb', existing: 'a\r\nb' })).toBe('open')
  })

  it('does nothing for a lesson with no starter code', () => {
    expect(seedAction({ existing: 'mine' })).toBe('keep')
    expect(seedAction({ starter: '', existing: null })).toBe('keep')
  })
})

describe('lessonFileName', () => {
  it('is stable and zero-padded, so revisiting targets the same buffer', () => {
    expect(lessonFileName('robotics', 0)).toBe('robotics-01.py')
    expect(lessonFileName('robotics', 11)).toBe('robotics-12.py')
  })

  it('does not go negative on a bad index', () => {
    expect(lessonFileName('c', -3)).toBe('c-01.py')
  })
})
