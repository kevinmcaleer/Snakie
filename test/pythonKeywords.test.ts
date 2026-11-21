import { describe, expect, it } from 'vitest'
import { keywordsAt } from '../src/renderer/src/components/python-keywords'

const kw = (before: string, line: string): string[] =>
  keywordsAt(before ? before.split('\n') : [], line).map((k) => k.keyword)

describe('keywordsAt', () => {
  it('offers from and import at the start of a file', () => {
    expect(kw('', 'fro')).toContain('from')
    expect(kw('', 'imp')).toContain('import')
    expect(kw('', '')).toContain('def')
  })

  it('offers import after from <module>', () => {
    expect(kw('', 'from machine i')).toEqual(['import'])
    expect(kw('', 'from machine ')).toEqual(['import'])
  })

  it('offers as after import <module> and after the imported names', () => {
    expect(kw('', 'import machine a')).toEqual(['as'])
    expect(kw('', 'from machine import Pin a')).toEqual(['as'])
    expect(kw('', 'import machine as m')).toEqual([])
  })

  it('offers elif and else only after an if block at the same indent', () => {
    expect(kw('if x:\n    pass', 'el')).toEqual(expect.arrayContaining(['elif', 'else']))
    expect(kw('x = 1', 'el')).not.toContain('elif')
    expect(kw('x = 1', 'el')).not.toContain('else')
    // Indented inside the if: not a continuation of it.
    expect(kw('if x:', '    el')).not.toContain('elif')
  })

  it('offers except and finally after try', () => {
    expect(kw('try:\n    f()', 'ex')).toEqual(expect.arrayContaining(['except', 'finally']))
  })

  it('offers return only inside a def, break and continue only inside a loop', () => {
    expect(kw('def f():', '    re')).toContain('return')
    expect(kw('', 're')).not.toContain('return')
    expect(kw('while True:', '    br')).toEqual(expect.arrayContaining(['break', 'continue']))
    expect(kw('', 'br')).not.toContain('break')
    // A def inside a loop is a new scope: no break there.
    expect(kw('for i in x:\n    def f():', '        b')).not.toContain('break')
  })

  it('offers await only inside async def', () => {
    expect(kw('async def go():', '    aw')).toContain('await')
    expect(kw('def go():', '    aw')).not.toContain('await')
  })

  it('offers in after for <target>', () => {
    expect(kw('', 'for i ')).toEqual(['in'])
    expect(kw('', 'for x, y i')).toEqual(['in'])
  })

  it('offers True / False / None where an expression goes', () => {
    expect(kw('', 'led = Tr')).toEqual(expect.arrayContaining(['True', 'False', 'None', 'not']))
    expect(kw('', 'led.value(Fa')).toContain('False')
    expect(kw('def f():', '    return N')).toContain('None')
    expect(kw('', 'if x == N')).toContain('None')
  })

  it('offers and / or / is after a finished term', () => {
    expect(kw('', 'if a an')).toEqual(expect.arrayContaining(['and', 'or', 'is', 'in']))
  })

  it('offers nothing after a dot or inside a string or comment', () => {
    expect(kw('', 'machine.fr')).toEqual([])
    expect(kw('', 'print("fro')).toEqual([])
  })

  it('gives bare keywords no trailing space', () => {
    const items = keywordsAt([], 'x = Tr')
    expect(items.find((k) => k.keyword === 'True')?.insert).toBe('True')
    expect(keywordsAt([], 'fro').find((k) => k.keyword === 'from')?.insert).toBe('from ')
  })
})

describe('keywordsAt — naming things', () => {
  it('offers nothing while naming a def, class or alias', () => {
    expect(kw('', 'def fo')).toEqual([])
    expect(kw('', 'class Ro')).toEqual([])
    expect(kw('', 'import ma')).toEqual([])
  })
})
