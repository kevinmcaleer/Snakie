import { describe, it, expect } from 'vitest'
import {
  CONTROL_SENTINEL,
  buildControlLine,
  isControl,
  buildTeleopPayload
} from '../src/renderer/src/components/snakie-control'

describe('snakie-control buildControlLine', () => {
  it('builds a target + payload line ending in one newline', () => {
    expect(buildControlLine('led', 'pwm 0.5')).toBe('SNKCMD led pwm 0.5\n')
  })

  it('builds a bare target line when payload is empty', () => {
    expect(buildControlLine('scan:i2c')).toBe('SNKCMD scan:i2c\n')
  })

  it('reduces a multi-word target to a single hyphen-joined token', () => {
    expect(buildControlLine('left motor', 'on')).toBe('SNKCMD left-motor on\n')
  })

  it('keeps internal payload spaces but trims the ends', () => {
    expect(buildControlLine('buzzer', '  tone 440 200  ')).toBe('SNKCMD buzzer tone 440 200\n')
  })

  it('strips embedded newlines so a second line cannot be injected', () => {
    expect(buildControlLine('led', 'on\nSNKCMD led off')).toBe('SNKCMD led on SNKCMD led off\n')
  })

  it('exposes the control sentinel', () => {
    expect(CONTROL_SENTINEL).toBe('SNKCMD')
  })
})

describe('snakie-control isControl', () => {
  it('detects a SNKCMD line', () => {
    expect(isControl('SNKCMD led on')).toBe(true)
  })

  it('tolerates leading whitespace', () => {
    expect(isControl('   SNKCMD teleop axes=lx:0.5')).toBe(true)
  })

  it('does not treat a SNK telemetry line as control', () => {
    expect(isControl('SNK SCOPE pwm 0.5')).toBe(false)
  })

  it('does not match an embedded SNKCMD later in the line', () => {
    expect(isControl('echo SNKCMD led on')).toBe(false)
  })

  it('rejects an empty line', () => {
    expect(isControl('')).toBe(false)
  })
})

describe('snakie-control buildTeleopPayload', () => {
  it('serialises axes and pressed buttons', () => {
    expect(buildTeleopPayload({ lx: 0.5, ly: -0.2 }, { a: true, b: false })).toBe(
      'axes=lx:0.5,ly:-0.2 btn:a=1'
    )
  })

  it('omits the axes token when there are no axes', () => {
    expect(buildTeleopPayload({}, { start: true })).toBe('btn:start=1')
  })

  it('is empty when nothing is active', () => {
    expect(buildTeleopPayload({}, {})).toBe('')
  })

  it('round-trips into a control line', () => {
    const payload = buildTeleopPayload({ lx: 1 }, { fire: true })
    expect(buildControlLine('teleop', payload)).toBe('SNKCMD teleop axes=lx:1 btn:fire=1\n')
  })
})
