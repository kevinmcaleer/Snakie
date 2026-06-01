import { describe, it, expect } from 'vitest'
import { parseVariables } from '../src/renderer/src/components/VariablesPanel'

const FS = '␟' // SYMBOL FOR UNIT SEPARATOR (␟)
const START = '<<SNAKIE_VARS>>'
const END = '<<SNAKIE_VARS_END>>'

/** Helper to build a record line with the sentinel field separator. */
function rec(name: string, type: string, repr: string): string {
  return `${name}${FS}${type}${FS}${repr}`
}

describe('parseVariables', () => {
  it('returns nothing for empty input', () => {
    expect(parseVariables('')).toEqual([])
  })

  it('parses name/type/repr records between sentinels', () => {
    const stdout = [START, rec('x', 'int', '42'), rec('s', 'str', "'hi'"), END].join('\n')
    expect(parseVariables(stdout)).toEqual([
      { name: 'x', type: 'int', value: '42' },
      { name: 's', type: 'str', value: "'hi'" }
    ])
  })

  it('ignores anything before the start sentinel', () => {
    const stdout = ['noise', rec('pre', 'int', '0'), START, rec('x', 'int', '1'), END].join('\n')
    expect(parseVariables(stdout)).toEqual([{ name: 'x', type: 'int', value: '1' }])
  })

  it('stops at the end sentinel', () => {
    const stdout = [START, rec('x', 'int', '1'), END, rec('after', 'int', '2')].join('\n')
    expect(parseVariables(stdout)).toEqual([{ name: 'x', type: 'int', value: '1' }])
  })

  it('preserves a repr that itself contains the field separator', () => {
    // Only the first two separators delimit name/type; the rest is the repr.
    const value = `['a${FS}b', 'c${FS}d']`
    const stdout = [START, rec('lst', 'list', value), END].join('\n')
    expect(parseVariables(stdout)).toEqual([{ name: 'lst', type: 'list', value }])
  })

  it('skips lines with fewer than two separators', () => {
    const stdout = [START, 'garbage-no-sep', `onlyone${FS}field`, rec('ok', 'int', '5'), END].join(
      '\n'
    )
    expect(parseVariables(stdout)).toEqual([{ name: 'ok', type: 'int', value: '5' }])
  })

  it('skips records with an empty name', () => {
    const stdout = [START, rec('', 'int', '0'), rec('ok', 'int', '1'), END].join('\n')
    expect(parseVariables(stdout)).toEqual([{ name: 'ok', type: 'int', value: '1' }])
  })

  it('allows an empty type and empty repr', () => {
    const stdout = [START, rec('e', '', ''), END].join('\n')
    expect(parseVariables(stdout)).toEqual([{ name: 'e', type: '', value: '' }])
  })

  it('ignores records emitted before any start sentinel even with separators', () => {
    const stdout = [rec('x', 'int', '1')].join('\n')
    expect(parseVariables(stdout)).toEqual([])
  })

  it('handles CRLF line endings', () => {
    const stdout = [START, rec('x', 'int', '1'), END].join('\r\n')
    expect(parseVariables(stdout)).toEqual([{ name: 'x', type: 'int', value: '1' }])
  })

  it('reads the device error sentinel record as a normal variable row', () => {
    const stdout = [START, rec('ERR', 'error', "Exception('boom')"), END].join('\n')
    expect(parseVariables(stdout)).toEqual([
      { name: 'ERR', type: 'error', value: "Exception('boom')" }
    ])
  })
})
