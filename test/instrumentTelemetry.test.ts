import { describe, it, expect } from 'vitest'
import {
  isTelemetry,
  parseTelemetry,
  TELEMETRY_SENTINEL
} from '../src/renderer/src/components/instrument-telemetry'

describe('instrument-telemetry isTelemetry', () => {
  it('detects a SNK-prefixed line', () => {
    expect(isTelemetry('SNK SCOPE pwm 0.5')).toBe(true)
  })

  it('tolerates leading whitespace', () => {
    expect(isTelemetry('   SNK METER adc0 1.65 V')).toBe(true)
  })

  it('accepts a bare sentinel token', () => {
    expect(isTelemetry('SNK')).toBe(true)
  })

  it('rejects a plain print line', () => {
    expect(isTelemetry('temp:21.4')).toBe(false)
  })

  it('rejects an empty line', () => {
    expect(isTelemetry('')).toBe(false)
  })

  it('does not match an embedded SNK later in the line', () => {
    expect(isTelemetry('value is SNK SCOPE')).toBe(false)
  })

  it('exposes the sentinel constant', () => {
    expect(TELEMETRY_SENTINEL).toBe('SNK')
  })
})

describe('instrument-telemetry parseTelemetry — SCOPE', () => {
  it('parses a scope sample', () => {
    expect(parseTelemetry('SNK SCOPE pwm 0.75')).toEqual({
      kind: 'scope',
      ch: 'pwm',
      value: 0.75
    })
  })

  it('parses an integer scope value', () => {
    expect(parseTelemetry('SNK SCOPE ch1 3')).toEqual({
      kind: 'scope',
      ch: 'ch1',
      value: 3
    })
  })

  it('parses a live PWM reading (freq + duty)', () => {
    expect(parseTelemetry('SNK PWM pwm 1000 0.05')).toEqual({
      kind: 'pwm',
      ch: 'pwm',
      freq: 1000,
      duty: 0.05
    })
  })

  it('rejects a malformed PWM line', () => {
    expect(parseTelemetry('SNK PWM pwm 1000')).toBeNull() // missing duty
    expect(parseTelemetry('SNK PWM pwm x 0.5')).toBeNull() // non-numeric freq
  })

  it('parses a negative scope value', () => {
    expect(parseTelemetry('SNK SCOPE sig -1.5')).toEqual({
      kind: 'scope',
      ch: 'sig',
      value: -1.5
    })
  })

  it('returns null when the scope value is missing', () => {
    expect(parseTelemetry('SNK SCOPE pwm')).toBeNull()
  })

  it('returns null when the scope value is non-numeric', () => {
    expect(parseTelemetry('SNK SCOPE pwm high')).toBeNull()
  })
})

describe('instrument-telemetry parseTelemetry — METER', () => {
  it('parses a meter reading with an explicit unit', () => {
    expect(parseTelemetry('SNK METER adc0 1.65 V')).toEqual({
      kind: 'meter',
      ch: 'adc0',
      value: 1.65,
      unit: 'V'
    })
  })

  it('defaults the unit to V when omitted', () => {
    expect(parseTelemetry('SNK METER adc0 3.3')).toEqual({
      kind: 'meter',
      ch: 'adc0',
      value: 3.3,
      unit: 'V'
    })
  })

  it('keeps a custom unit', () => {
    expect(parseTelemetry('SNK METER temp 25.0 C')).toEqual({
      kind: 'meter',
      ch: 'temp',
      value: 25,
      unit: 'C'
    })
  })

  it('returns null when the meter value is non-numeric', () => {
    expect(parseTelemetry('SNK METER adc0 nope V')).toBeNull()
  })
})

describe('instrument-telemetry parseTelemetry — PLOT', () => {
  it('parses bare numbers into positional series', () => {
    expect(parseTelemetry('SNK PLOT 1 2 3')).toEqual({
      kind: 'plot',
      series: [
        { label: 'series 1', value: 1 },
        { label: 'series 2', value: 2 },
        { label: 'series 3', value: 3 }
      ]
    })
  })

  it('parses named series (name=value)', () => {
    expect(parseTelemetry('SNK PLOT temp=21.4 light=80')).toEqual({
      kind: 'plot',
      series: [
        { label: 'temp', value: 21.4 },
        { label: 'light', value: 80 }
      ]
    })
  })

  it('parses name:value pairs', () => {
    expect(parseTelemetry('SNK PLOT x:1 y:2')).toEqual({
      kind: 'plot',
      series: [
        { label: 'x', value: 1 },
        { label: 'y', value: 2 }
      ]
    })
  })

  it('mixes bare and named tokens with positional fallback labels', () => {
    expect(parseTelemetry('SNK PLOT 5 x=1 6')).toEqual({
      kind: 'plot',
      series: [
        { label: 'series 1', value: 5 },
        { label: 'x', value: 1 },
        { label: 'series 2', value: 6 }
      ]
    })
  })

  it('returns null for an empty PLOT payload', () => {
    expect(parseTelemetry('SNK PLOT')).toBeNull()
  })

  it('returns null when no token has a parsable number', () => {
    expect(parseTelemetry('SNK PLOT hello world')).toBeNull()
  })
})

describe('instrument-telemetry parseTelemetry — IMU', () => {
  it('parses Euler angles', () => {
    expect(parseTelemetry('SNK IMU imu 0 1.2 90')).toEqual({
      kind: 'imu',
      ch: 'imu',
      roll: 0,
      pitch: 1.2,
      yaw: 90
    })
  })

  it('parses negative angles', () => {
    expect(parseTelemetry('SNK IMU head -10 -20.5 -3')).toEqual({
      kind: 'imu',
      ch: 'head',
      roll: -10,
      pitch: -20.5,
      yaw: -3
    })
  })

  it('returns null when an angle is missing', () => {
    expect(parseTelemetry('SNK IMU imu 1 2')).toBeNull()
  })

  it('parses a quaternion', () => {
    expect(parseTelemetry('SNK IMUQ imu 1 0 0 0')).toEqual({
      kind: 'imuq',
      ch: 'imu',
      w: 1,
      x: 0,
      y: 0,
      z: 0
    })
  })

  it('returns null for an incomplete quaternion', () => {
    expect(parseTelemetry('SNK IMUQ imu 1 0 0')).toBeNull()
  })
})

describe('instrument-telemetry parseTelemetry — DIST', () => {
  it('parses a distance with no angle', () => {
    expect(parseTelemetry('SNK DIST dist 123')).toEqual({
      kind: 'dist',
      ch: 'dist',
      mm: 123
    })
  })

  it('parses a distance with a bearing', () => {
    expect(parseTelemetry('SNK DIST lidar 250 45')).toEqual({
      kind: 'dist',
      ch: 'lidar',
      mm: 250,
      angle: 45
    })
  })

  it('ignores a non-numeric angle (keeps the mm)', () => {
    expect(parseTelemetry('SNK DIST dist 99 north')).toEqual({
      kind: 'dist',
      ch: 'dist',
      mm: 99
    })
  })

  it('returns null when mm is missing', () => {
    expect(parseTelemetry('SNK DIST dist')).toBeNull()
  })
})

describe('instrument-telemetry parseTelemetry — BTN / ENC', () => {
  it('parses a button down', () => {
    expect(parseTelemetry('SNK BTN a 1')).toEqual({ kind: 'btn', name: 'a', pressed: true })
  })

  it('parses a button up', () => {
    expect(parseTelemetry('SNK BTN start 0')).toEqual({
      kind: 'btn',
      name: 'start',
      pressed: false
    })
  })

  it('returns null for a non-binary button state', () => {
    expect(parseTelemetry('SNK BTN a 2')).toBeNull()
  })

  it('parses an encoder count only', () => {
    expect(parseTelemetry('SNK ENC enc 17')).toEqual({ kind: 'enc', ch: 'enc', count: 17 })
  })

  it('parses an encoder with a press state', () => {
    expect(parseTelemetry('SNK ENC dial -3 1')).toEqual({
      kind: 'enc',
      ch: 'dial',
      count: -3,
      pressed: true
    })
  })

  it('returns null when the encoder count is non-numeric', () => {
    expect(parseTelemetry('SNK ENC enc spin')).toBeNull()
  })
})

describe('instrument-telemetry parseTelemetry — SCR', () => {
  it('parses text rows and decodes the space placeholder', () => {
    expect(parseTelemetry('SNK SCR 0x3C text Hello_world Line_2')).toEqual({
      kind: 'scr',
      addr: '0x3C',
      rows: ['Hello world', 'Line 2']
    })
  })

  it('parses an empty text screen', () => {
    expect(parseTelemetry('SNK SCR 0x3C text')).toEqual({
      kind: 'scr',
      addr: '0x3C',
      rows: []
    })
  })

  it('parses a framebuffer', () => {
    expect(parseTelemetry('SNK SCR 0x3C fb 8 8 b64 AAEC')).toEqual({
      kind: 'scr',
      addr: '0x3C',
      framebuffer: { w: 8, h: 8, encoding: 'b64', data: 'AAEC' }
    })
  })

  it('returns null for an incomplete framebuffer', () => {
    expect(parseTelemetry('SNK SCR 0x3C fb 8 8 b64')).toBeNull()
  })

  it('returns null for an unknown screen mode', () => {
    expect(parseTelemetry('SNK SCR 0x3C blink')).toBeNull()
  })
})

describe('instrument-telemetry parseTelemetry — scan result sets', () => {
  it('parses an I2C scan result set', () => {
    expect(parseTelemetry('SNK I2C 0x3C 0x68')).toEqual({
      kind: 'i2c',
      addrs: ['0x3C', '0x68']
    })
  })

  it('parses an empty I2C bus', () => {
    expect(parseTelemetry('SNK I2C')).toEqual({ kind: 'i2c', addrs: [] })
  })

  it('parses one Wi-Fi network (and decodes the SSID placeholder)', () => {
    expect(parseTelemetry('SNK WIFI My_Network -42 6 WPA2')).toEqual({
      kind: 'wifi',
      ssid: 'My Network',
      rssi: -42,
      channel: 6,
      security: 'WPA2'
    })
  })

  it('returns null for a malformed Wi-Fi line', () => {
    expect(parseTelemetry('SNK WIFI ssid -42 six WPA2')).toBeNull()
  })

  it('parses one Bluetooth device', () => {
    expect(parseTelemetry('SNK BT My_Tag AA:BB:CC -57')).toEqual({
      kind: 'bt',
      name: 'My Tag',
      mac: 'AA:BB:CC',
      rssi: -57
    })
  })

  it('returns null for a Bluetooth line with no rssi', () => {
    expect(parseTelemetry('SNK BT tag AA:BB:CC')).toBeNull()
  })
})

describe('instrument-telemetry parseTelemetry — non-telemetry / unknown', () => {
  it('returns null for a plain numeric print', () => {
    expect(parseTelemetry('12.5')).toBeNull()
  })

  it('returns null for a labelled print without the sentinel', () => {
    expect(parseTelemetry('temp:21.4, humidity:48')).toBeNull()
  })

  it('returns null for an empty line', () => {
    expect(parseTelemetry('')).toBeNull()
  })

  it('returns null for an unknown SNK sub-command', () => {
    expect(parseTelemetry('SNK WOBBLE 1 2')).toBeNull()
  })

  it('returns null for a bare sentinel with no sub-command', () => {
    expect(parseTelemetry('SNK')).toBeNull()
  })
})
