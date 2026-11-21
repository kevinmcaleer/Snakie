import { describe, it, expect } from 'vitest'
import {
  DemoTelemetryGate,
  instrumentsHelperCalls,
  programTelemetryKinds,
  simulatedTelemetryFrame,
  telemetryKind
} from '../src/shared/simulation'
import { instrumentsForProgram } from '../src/renderer/src/components/instruments-registry'

// The Snakie Instruments course's first example, exactly as the lesson has it.
const WAVE = `import math, time
import instruments as inst

for i in range(300):
    inst.plot(sine=math.sin(i / 10), cosine=math.cos(i / 10))
    time.sleep(0.05)
`

describe('instrumentsHelperCalls', () => {
  it('reads calls through an aliased import', () => {
    expect([...instrumentsHelperCalls(WAVE)]).toEqual(['plot'])
  })

  it('reads the plain module name, a comma import and from-imports', () => {
    expect(instrumentsHelperCalls('import instruments\ninstruments.meter(1)').has('meter')).toBe(true)
    expect(instrumentsHelperCalls('import os, instruments as i\ni.scope(0)').has('scope')).toBe(true)
    const code = 'from instruments import plot, read_adc as adcv\nplot(a=1)\nadcv(x)'
    expect([...instrumentsHelperCalls(code)].sort()).toEqual(['plot', 'read_adc'])
  })

  it('ignores a same-named function on something else', () => {
    expect(instrumentsHelperCalls('import matplotlib as plt\nplt.plot(1)').size).toBe(0)
    expect(instrumentsHelperCalls('def plot(x):\n    pass\nplot(1)').size).toBe(0)
  })
})

describe('programTelemetryKinds', () => {
  it('maps helpers to the kind they print', () => {
    expect([...programTelemetryKinds(WAVE)]).toEqual(['PLOT'])
    const code = 'import instruments as inst\ninst.read_adc(a)\ninst.read_pwm(p)'
    expect([...programTelemetryKinds(code)].sort()).toEqual(['METER', 'SCOPE'])
  })
})

describe('DemoTelemetryGate', () => {
  const kinds = (lines: string[]): string[] => lines.map((l) => telemetryKind(l) ?? '?')

  it('passes the whole demo frame when no program runs', () => {
    const gate = new DemoTelemetryGate()
    const frame = simulatedTelemetryFrame(0)
    expect(gate.filter(frame)).toEqual(frame)
  })

  it('drops the demo plot while a plotting program runs, and brings it back after', () => {
    const gate = new DemoTelemetryGate()
    gate.begin(WAVE)
    const during = gate.filter(simulatedTelemetryFrame(0))
    expect(kinds(during)).not.toContain('PLOT')
    expect(kinds(during)).toContain('SCOPE')
    gate.end()
    expect(kinds(gate.filter(simulatedTelemetryFrame(0)))).toContain('PLOT')
  })

  it('learns kinds from the program output, across chunk boundaries', () => {
    const gate = new DemoTelemetryGate()
    gate.begin('print("hi")')
    gate.note('SNK ME')
    gate.note('TER v 1.2 V\r\nSNK PWM pwm 50 0.5\r\n')
    const k = kinds(gate.filter(simulatedTelemetryFrame(0)))
    expect(k).not.toContain('METER')
    // PWM is drawn on the scope, so it silences the demo scope too.
    expect(k).not.toContain('SCOPE')
    expect(k).toContain('PLOT')
  })
})

describe('instrumentsForProgram', () => {
  it('opens the Plotter for the course wave example', () => {
    expect(instrumentsForProgram(WAVE)).toEqual(['plotter'])
  })

  it('maps the read helpers to their instruments', () => {
    const code = 'import instruments as inst\ninst.read_adc(a)\ninst.read_pwm(p)\ninst.imu_quat(1,0,0,0)'
    expect(instrumentsForProgram(code)).toEqual(['scope', 'meter', 'imu'])
  })

  it('opens nothing for start() or a program without instruments', () => {
    expect(instrumentsForProgram('import instruments as inst\ninst.start(i2c=i2c)')).toEqual([])
    expect(instrumentsForProgram('print("hello")')).toEqual([])
  })
})
