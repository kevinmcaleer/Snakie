import { describe, it, expect } from 'vitest'
import { parseLine } from '../src/renderer/src/components/Plotter.parse'

describe('Plotter parseLine', () => {
  it('returns nothing for an empty string', () => {
    expect(parseLine('')).toEqual([])
  })

  it('parses a single number', () => {
    expect(parseLine('12.5')).toEqual([{ label: null, value: 12.5 }])
  })

  it('parses negative and decimal numbers', () => {
    expect(parseLine('-3.14')).toEqual([{ label: null, value: -3.14 }])
  })

  it('parses comma-separated values', () => {
    expect(parseLine('1, 2, 3')).toEqual([
      { label: null, value: 1 },
      { label: null, value: 2 },
      { label: null, value: 3 }
    ])
  })

  it('parses space-separated values', () => {
    expect(parseLine('1 2 3')).toEqual([
      { label: null, value: 1 },
      { label: null, value: 2 },
      { label: null, value: 3 }
    ])
  })

  it('parses tab-separated values', () => {
    expect(parseLine('1\t2\t3')).toEqual([
      { label: null, value: 1 },
      { label: null, value: 2 },
      { label: null, value: 3 }
    ])
  })

  it('parses label:value pairs', () => {
    expect(parseLine('temp:21.4, humidity:48')).toEqual([
      { label: 'temp', value: 21.4 },
      { label: 'humidity', value: 48 }
    ])
  })

  it('parses label=value pairs', () => {
    expect(parseLine('x=1 y=2')).toEqual([
      { label: 'x', value: 1 },
      { label: 'y', value: 2 }
    ])
  })

  it('ignores non-numeric tokens', () => {
    expect(parseLine('hello world')).toEqual([])
  })

  it('ignores tokens whose value side is non-numeric', () => {
    // `temp:` requires a value starting with -?digit; "abc" has no leading digit.
    expect(parseLine('temp:abc')).toEqual([])
  })

  it('mixes labelled and unlabelled tokens', () => {
    expect(parseLine('1 x=2 3')).toEqual([
      { label: null, value: 1 },
      { label: 'x', value: 2 },
      { label: null, value: 3 }
    ])
  })

  it('drops NaN / non-finite tokens but keeps valid neighbours', () => {
    // "1e9999" parses to Infinity (not finite) and is dropped.
    expect(parseLine('5 1e9999 6')).toEqual([
      { label: null, value: 5 },
      { label: null, value: 6 }
    ])
  })

  it('treats a bare numeric string with units as a non-number', () => {
    // "12px" -> Number('12px') is NaN, dropped.
    expect(parseLine('12px')).toEqual([])
  })

  it('parses exponent notation', () => {
    expect(parseLine('1.5e3')).toEqual([{ label: null, value: 1500 }])
  })

  it('collapses runs of spaces between values', () => {
    expect(parseLine('7    8')).toEqual([
      { label: null, value: 7 },
      { label: null, value: 8 }
    ])
  })
})
