import { describe, it, expect } from 'vitest'
import {
  splitLines,
  splitLine,
  detectDelimiter,
  detectHeader,
  isNumeric,
  isTimestamp,
  inferColumnType,
  parseTable,
  delimiterLabel
} from '../src/renderer/src/components/data-table'

describe('splitLines / splitLine (#274)', () => {
  it('splits on any newline style and drops blank lines', () => {
    expect(splitLines('a\r\nb\n\n c \r\r')).toEqual(['a', 'b', ' c '])
    expect(splitLines('')).toEqual([])
  })
  it('quote-aware comma split (RFC-4180-ish) with escaped quotes', () => {
    expect(splitLine('a,b,c', ',')).toEqual(['a', 'b', 'c'])
    expect(splitLine('"a,1","b ""x""",c', ',')).toEqual(['a,1', 'b "x"', 'c'])
    expect(splitLine('1;2;3', ';')).toEqual(['1', '2', '3'])
  })
  it('whitespace split collapses runs', () => {
    expect(splitLine('1   2\t3   4', 'ws')).toEqual(['1', '2', '3', '4'])
  })
})

describe('detectDelimiter (#274)', () => {
  it('detects comma / tab / semicolon / whitespace by consistency', () => {
    expect(detectDelimiter(['t,temp,hum', '0,21.5,40', '1,21.6,41'])).toBe(',')
    expect(detectDelimiter(['t\ttemp', '0\t21.5', '1\t21.6'])).toBe('\t')
    expect(detectDelimiter(['t;temp', '0;21.5'])).toBe(';')
    expect(detectDelimiter(['t temp hum', '0 21.5 40', '1 21.6 41'])).toBe('ws')
  })
  it('prefers the delimiter that splits consistently, not an incidental one', () => {
    // Commas are the real delimiter; a stray semicolon in one text cell mustn't win.
    expect(detectDelimiter(['name,note', 'a,hi; there', 'b,ok'])).toBe(',')
  })
})

describe('type predicates + inference (#274)', () => {
  it('isNumeric handles ints, floats, signs, exponents; rejects text/blank', () => {
    for (const v of ['0', '-3', '21.5', '.5', '2.', '1e3', '-1.2E-4']) expect(isNumeric(v), v).toBe(true)
    for (const v of ['', 'abc', '1,2', '0x10', '12:00']) expect(isNumeric(v), v).toBe(false)
  })
  it('isTimestamp matches ISO date/time, slashes and clock times', () => {
    for (const v of ['2026-07-07', '2026-07-07T13:04:05', '2026/07/07 13:04', '13:04:05', '9:30'])
      expect(isTimestamp(v), v).toBe(true)
    for (const v of ['21.5', 'hello', '2026-13-40']) expect(isTimestamp(v), v).toBe(false)
  })
  it('inferColumnType: 80% rule, ignoring blanks', () => {
    expect(inferColumnType(['1', '2', '3', ''])).toBe('number')
    expect(inferColumnType(['2026-07-07', '2026-07-08', ''])).toBe('timestamp')
    expect(inferColumnType(['on', 'off', 'on'])).toBe('string')
    // Mostly numbers with one stray label → still number (≥80%).
    expect(inferColumnType(['1', '2', '3', '4', 'n/a'])).toBe('number')
    // Half and half → string.
    expect(inferColumnType(['1', '2', 'a', 'b'])).toBe('string')
  })
})

describe('detectHeader (#274)', () => {
  it('spots a text header over numeric columns', () => {
    expect(detectHeader([['time', 'temp'], ['0', '21.5'], ['1', '21.6']])).toBe(true)
  })
  it('no header when the first row is numeric like the rest', () => {
    expect(detectHeader([['0', '21.5'], ['1', '21.6']])).toBe(false)
  })
  it('rejects a first row with blanks or duplicate names', () => {
    expect(detectHeader([['time', ''], ['0', '1']])).toBe(false)
    expect(detectHeader([['t', 't'], ['0', '1']])).toBe(false)
  })
})

describe('parseTable — robustness (#274)', () => {
  it('parses a clean CSV with header + inferred types', () => {
    const t = parseTable('time,temp,label\n0,21.5,ok\n1,21.6,ok')
    expect(t.delimiter).toBe(',')
    expect(t.hasHeader).toBe(true)
    expect(t.columns.map((c) => `${c.name}:${c.type}`)).toEqual(['time:number', 'temp:number', 'label:string'])
    expect(t.rows).toEqual([
      ['0', '21.5', 'ok'],
      ['1', '21.6', 'ok']
    ])
    expect(t.rowCount).toBe(2)
    expect(t.raggedRows).toBe(0)
  })

  it('tolerates ragged rows: pads a torn final row, truncates an over-long one', () => {
    // Header defines 3 cols; row 2 is short (unplugged mid-write), row 3 too long.
    const t = parseTable('a,b,c\n1,2,3\n4,5\n6,7,8,9')
    expect(t.columns).toHaveLength(3)
    expect(t.rows).toEqual([
      ['1', '2', '3'],
      ['4', '5', ''], // padded
      ['6', '7', '8'] // truncated
    ])
    expect(t.raggedRows).toBe(2)
    expect(t.rowCount).toBe(3)
  })

  it('drops blank lines and never throws on junk', () => {
    expect(() => parseTable('')).not.toThrow()
    expect(parseTable('').columns).toHaveLength(0)
    const t = parseTable('x,y\n\n1,2\n\n3,4\n')
    expect(t.rowCount).toBe(2)
  })

  it('a headerless numeric table gets positional column names', () => {
    const t = parseTable('0 21.5\n1 21.6\n2 21.7')
    expect(t.delimiter).toBe('ws')
    expect(t.hasHeader).toBe(false)
    expect(t.columns.map((c) => c.name)).toEqual(['col 1', 'col 2'])
    expect(t.columns.every((c) => c.type === 'number')).toBe(true)
  })

  it('honours delimiter / header / type overrides', () => {
    const t = parseTable('1;2;3\n4;5;6', {
      delimiter: ';',
      hasHeader: false,
      columnTypes: { 0: 'string' }
    })
    expect(t.columns[0].type).toBe('string')
    expect(t.columns[1].type).toBe('number')
    expect(t.rows).toHaveLength(2)
  })

  it('scales to many rows without choking (smoke)', () => {
    const lines = ['t,v']
    for (let i = 0; i < 20000; i++) lines.push(`${i},${(i % 100) / 10}`)
    const t = parseTable(lines.join('\n'))
    expect(t.rowCount).toBe(20000)
    expect(t.columns[1].type).toBe('number')
  })
})

describe('delimiterLabel', () => {
  it('names each delimiter', () => {
    expect(delimiterLabel(',')).toBe('comma')
    expect(delimiterLabel('\t')).toBe('tab')
    expect(delimiterLabel(';')).toBe('semicolon')
    expect(delimiterLabel('ws')).toBe('whitespace')
  })
})
