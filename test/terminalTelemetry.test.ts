import { describe, it, expect } from 'vitest'
import { makeTelemetryFilter } from '../src/renderer/src/components/terminal-telemetry'

/** Feed a whole string through a fresh filter, concatenating all output. */
function run(input: string): string {
  const f = makeTelemetryFilter()
  return f.push(input)
}

describe('terminal-telemetry makeTelemetryFilter', () => {
  it('passes a plain print line through unchanged', () => {
    expect(run('hello world\n')).toBe('hello world\n')
  })

  it('drops a complete telemetry line', () => {
    expect(run('SNK SCOPE pwm 0.5\n')).toBe('')
  })

  it('keeps normal output but drops interleaved telemetry', () => {
    const input = 'starting\nSNK METER adc0 1.65 V\ndone\n'
    expect(run(input)).toBe('starting\ndone\n')
  })

  it('drops every telemetry kind', () => {
    const input =
      'SNK SCOPE pwm 0.5\n' + 'SNK METER adc0 1.6 V\n' + 'SNK PLOT a=1 b=2\n' + 'real output\n'
    expect(run(input)).toBe('real output\n')
  })

  it('preserves CRLF line endings on passthrough lines', () => {
    expect(run('alpha\r\nbeta\r\n')).toBe('alpha\r\nbeta\r\n')
  })

  it('drops a telemetry line with CRLF terminator', () => {
    expect(run('SNK SCOPE pwm 0.5\r\nkeep\r\n')).toBe('keep\r\n')
  })

  it('flushes a newline-less prompt immediately (not held)', () => {
    // A REPL prompt has no trailing newline and is not a SNK prefix → emit now.
    expect(run('>>> ')).toBe('>>> ')
  })

  it('flushes plain newline-less output immediately', () => {
    expect(run('partial output no newline')).toBe('partial output no newline')
  })

  it('holds a partial SNK prefix until it is decidable', () => {
    const f = makeTelemetryFilter()
    // "SNK " is a prefix of the sentinel → buffered, nothing emitted yet.
    expect(f.push('SNK ')).toBe('')
    // Completing it as a telemetry line → still dropped.
    expect(f.push('SCOPE pwm 0.5\n')).toBe('')
  })

  it('reassembles a telemetry line split across two chunks and drops it', () => {
    const f = makeTelemetryFilter()
    expect(f.push('SNK SCOPE p')).toBe('')
    expect(f.push('wm 0.5\nafter\n')).toBe('after\n')
  })

  it('reassembles a passthrough line split across chunks', () => {
    const f = makeTelemetryFilter()
    // "hel" is not a SNK prefix → released immediately.
    expect(f.push('hel')).toBe('hel')
    expect(f.push('lo\n')).toBe('lo\n')
  })

  it('does not drop a line that merely contains SNK later', () => {
    expect(run('the value is SNK-ish\n')).toBe('the value is SNK-ish\n')
  })

  it('drops a SNKCMD control echo (issue #115)', () => {
    expect(run('SNKCMD led on\n')).toBe('')
  })

  it('drops a control echo interleaved with normal output', () => {
    const input = 'go\nSNKCMD teleop axes=lx:0.5\nstop\n'
    expect(run(input)).toBe('go\nstop\n')
  })

  it('drops both telemetry and control lines together', () => {
    const input = 'SNK SCOPE pwm 0.5\nSNKCMD buzzer tone 440 200\nreal\n'
    expect(run(input)).toBe('real\n')
  })

  it('holds a partial SNKCMD prefix until decidable, then drops it', () => {
    const f = makeTelemetryFilter()
    // "SNKC" diverges from "SNK " but is a prefix of "SNKCMD " → still held.
    expect(f.push('SNKC')).toBe('')
    expect(f.push('MD led on\n')).toBe('')
  })

  it('releases a SNK-prefixed fragment that is neither sentinel', () => {
    const f = makeTelemetryFilter()
    // "SNKZ" is a prefix of neither "SNK " nor "SNKCMD " → released immediately.
    expect(f.push('SNKZ')).toBe('SNKZ')
  })

  it('holds a lone S/SN that could still grow into the sentinel', () => {
    const f = makeTelemetryFilter()
    expect(f.push('S')).toBe('')
    expect(f.push('N')).toBe('')
    // Diverges from "SNK " → the whole fragment is released.
    expect(f.push('ail\n')).toBe('SNail\n')
  })
})
