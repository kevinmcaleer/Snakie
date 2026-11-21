import { describe, expect, it, beforeAll } from 'vitest'
import { createRequire } from 'module'
import { SIM_MACHINE_PY } from '../src/shared/sim-machine'
import { SIM_CIRCUITPY_PY } from '../src/shared/sim-circuitpython'

type MP = { runPython: (code: string) => unknown }
const require = createRequire(import.meta.url)

let mp: MP
let out = ''
const run = (code: string): string => {
  out = ''
  mp.runPython(code)
  return out
}

beforeAll(async () => {
  const { loadMicroPython } = await import(
    require.resolve('@micropython/micropython-webassembly-pyscript/micropython.mjs')
  )
  const dec = new TextDecoder()
  const collect = (b: Uint8Array | string): void => {
    out += typeof b === 'string' ? b : dec.decode(b)
  }
  mp = await loadMicroPython({ stdout: collect, stderr: collect })
  mp.runPython(SIM_MACHINE_PY)
  mp.runPython(SIM_CIRCUITPY_PY)
}, 30000)

describe('CircuitPython on the MicroPython sim', () => {
  it('runs the CircuitPython blink, and the pin watch sees it', () => {
    const got = run(`
import board, digitalio, time, machine
seen = []
machine._watch = lambda kind, pin, v: seen.append((kind, pin, v))
led = digitalio.DigitalInOut(board.LED)
led.direction = digitalio.Direction.OUTPUT
led.value = True
print(led.value)
led.value = False
print(led.value, seen[-1])
machine._watch = None
`)
    expect(got).toContain('True')
    expect(got).toContain("False ('p', 'LED', 0)")
  })

  it('maps GP pins to their numbers and A0 to GP26', () => {
    expect(run('import board\nprint(board.GP15.id, board.A0.id, board.A0 == board.GP26, board.GP2)')).toContain(
      '15 26 True board.GP2'
    )
  })

  it('drives PWM and reads analog values', () => {
    const got = run(`
import board, pwmio, analogio
m = pwmio.PWMOut(board.GP0, frequency=1000, duty_cycle=0)
m.duty_cycle = 32768
pot = analogio.AnalogIn(board.A0)
v = pot.value
print(m.duty_cycle, m.frequency, 0 <= v <= 65535)
try:
    m.duty_cycle = 70000
except ValueError:
    print('range ok')
`)
    expect(got).toContain('32768 1000 True')
    expect(got).toContain('range ok')
  })

  it('pull-up inputs read True, and switch_to_output works', () => {
    const got = run(`
import board, digitalio
b = digitalio.DigitalInOut(board.GP14)
b.switch_to_input(pull=digitalio.Pull.UP)
o = digitalio.DigitalInOut(board.GP1)
o.switch_to_output(value=True)
print(b.value, o.value)
`)
    expect(got).toContain('True True')
  })

  it('has busio, microcontroller, supervisor and time.monotonic', () => {
    const got = run(`
import board, busio, microcontroller, supervisor, time
i2c = busio.I2C(board.GP5, board.GP4)
while not i2c.try_lock():
    pass
print(i2c.scan())
i2c.unlock()
t = time.monotonic()
print(type(t).__name__, microcontroller.cpu.temperature, supervisor.runtime.serial_connected)
`)
    expect(got).toContain('[]')
    expect(got).toContain('float 27.0 True')
  })

  it('leaves no names in the globals', () => {
    expect(run("print('__snakie_install_circuitpython' in globals())")).toContain('False')
  })
})
