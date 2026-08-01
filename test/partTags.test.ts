import { describe, it, expect } from 'vitest'
import { addTags, splitTagInput } from '../src/renderer/src/components/part-editor.util'

/**
 * The Tags field (#660).
 *
 * The old field bound `value` to `tags.join(', ')` and parsed with
 * `split(',').map(trim).filter(Boolean)`. Pressing `,` after `i2c` produced
 * `['i2c']` — identical to the model before it — so React re-rendered the old
 * string and the comma was erased: a second tag was unreachable by typing.
 *
 * These cover the helpers behind the chip-based replacement, including a
 * simulation of the keystroke sequence that used to fail.
 */
describe('splitTagInput (#660)', () => {
  it('splits on commas and trims', () => {
    expect(splitTagInput('i2c, distance, tof')).toEqual(['i2c', 'distance', 'tof'])
    expect(splitTagInput('i2c,distance')).toEqual(['i2c', 'distance'])
  })

  it('drops empties rather than producing blank tags', () => {
    expect(splitTagInput('i2c,')).toEqual(['i2c'])
    expect(splitTagInput(',,i2c,,')).toEqual(['i2c'])
    expect(splitTagInput('   ')).toEqual([])
    expect(splitTagInput('')).toEqual([])
  })
})

describe('addTags (#660)', () => {
  it('appends, preserving order', () => {
    expect(addTags(['i2c'], 'distance')).toEqual(['i2c', 'distance'])
    expect(addTags([], 'a, b, c')).toEqual(['a', 'b', 'c'])
  })

  it('rejects duplicates case-insensitively', () => {
    expect(addTags(['i2c'], 'I2C')).toEqual(['i2c'])
    expect(addTags(['i2c'], 'i2c, tof, TOF')).toEqual(['i2c', 'tof'])
  })

  it('never rewrites or de-duplicates what is already there', () => {
    // Opening a hand-authored part must not silently mutate its data.
    const existing = ['i2c', 'I2C', 'ToF']
    expect(addTags(existing, '')).toEqual(existing)
    expect(addTags(existing, 'new')).toEqual([...existing, 'new'])
  })

  it('adds nothing for blank input', () => {
    expect(addTags(['i2c'], '')).toEqual(['i2c'])
    expect(addTags(['i2c'], '  ,  ')).toEqual(['i2c'])
  })
})

describe('the regression: a second tag is reachable by typing (#660)', () => {
  /** The field commits on `,` and on Enter, keeping any remainder as the draft. */
  const type = (tags: string[], draft: string, ch: string): [string[], string] => {
    const v = draft + ch
    if (!v.includes(',')) return [tags, v]
    const cut = v.lastIndexOf(',')
    return [addTags(tags, v.slice(0, cut)), v.slice(cut + 1).trim()]
  }

  it('survives i2c , space d i s t a n c e', () => {
    let tags: string[] = []
    let draft = ''
    for (const ch of 'i2c, distance') [tags, draft] = type(tags, draft, ch)
    // The comma committed the first tag instead of vanishing...
    expect(tags).toEqual(['i2c'])
    // ...and the rest sits in the draft, ready for Enter or blur. The leading
    // space is the one the author typed and is kept verbatim while editing —
    // committing trims it, so it never reaches the saved tag.
    expect(draft).toBe(' distance')
    expect(addTags(tags, draft)).toEqual(['i2c', 'distance'])
  })

  it('still accepts a whole list pasted in one go (the old workaround)', () => {
    const [tags, draft] = type([], '', 'i2c, distance, tof')
    expect(tags).toEqual(['i2c', 'distance'])
    expect(draft).toBe('tof')
    expect(addTags(tags, draft)).toEqual(['i2c', 'distance', 'tof'])
  })
})
