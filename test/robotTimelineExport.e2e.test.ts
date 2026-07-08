import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { MicroPythonRuntime } from '../src/main/device/MicroPythonRuntime'
import { generateMicroPython } from '../src/shared/robot-timeline'
import type { MotionTimeline, ServoJointBinding } from '../src/shared/robot'

/**
 * ACCEPTANCE (#314): "Export produces RUNNABLE MicroPython that reproduces the
 * motion on hardware." This runs the generated program on the REAL MicroPython
 * WebAssembly interpreter (the same one the simulator uses) with the shipped
 * `instruments.py` installed, and asserts the `SNK SERVO <pin> <deg>` stream it
 * prints equals the baked FRAMES — i.e. the exported code both RUNS and emits the
 * exact servo choreography, which drives the on-screen joints via the #313 pipe.
 */
describe('motion export runs on the real interpreter (#314)', () => {
  it('emits the baked SNK SERVO frames when run', async () => {
    const rt = new MicroPythonRuntime()
    await rt.init(() => {})

    // Install the shipped instruments.py into /lib (on the WASM sys.path) so
    // `import instruments` works, exactly like the SimulatedDevice does.
    const instr = readFileSync(join(process.cwd(), 'micropython', 'instruments.py'), 'utf8')
    const hex = Buffer.from(instr, 'utf8').toString('hex')
    await rt.runCaptured(
      [
        'import os',
        'try:\n    os.mkdir("/lib")\nexcept OSError:\n    pass',
        `_d = bytes.fromhex(${JSON.stringify(hex)})`,
        'with open("/lib/instruments.py", "wb") as _f:\n    _f.write(_d)'
      ].join('\n')
    )

    // A short one-shot clip (loop:false → the program ends after one play()).
    const timeline: MotionTimeline = {
      duration: 1,
      easing: 'linear',
      loop: false,
      fps: 4,
      tracks: [{ joint: 'a', keys: [{ t: 0, value: 0 }, { t: 1, value: 100 }] }]
    }
    const bindings: ServoJointBinding[] = [
      { pin: 'GP0', joint: 'a', jointMin: 0, jointMax: 100, servoMin: 0, servoMax: 180 }
    ]
    const ex = generateMicroPython(timeline, bindings, { fps: 4 })

    // Expected servo degrees = the baked FRAMES tuple in the generated code.
    const expected = [...ex.code.matchAll(/^ {4}\((\d+),\),$/gm)].map((m) => Number(m[1]))
    expect(expected.length).toBe(5) // one-shot, N=4 → 5 frames

    const out = await rt.runCaptured(ex.code)
    const emitted = [...out.matchAll(/SNK SERVO 0 (\d+)/g)].map((m) => Number(m[1]))
    rt.dispose()

    // The run produced exactly the baked servo sequence — runnable + faithful.
    expect(emitted).toEqual(expected)
    // sanity: a linear 0→100° joint on a 0-100↔0-180 map ramps 0→180 servo.
    expect(emitted[0]).toBe(0)
    expect(emitted[emitted.length - 1]).toBe(180)
  }, 30000)
})
