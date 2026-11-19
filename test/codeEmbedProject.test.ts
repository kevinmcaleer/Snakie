import { describe, expect, it } from 'vitest'
import { BUILTIN_BOARDS } from '../src/renderer/src/components/board-defs'
import { pinsInCode, projectWiring, wiringMismatch } from '../src/renderer/src/code-embed/embed-pins'
import { parseEmbedParams } from '../src/renderer/src/code-embed/params'
import { loadProgram, type Fetcher } from '../src/renderer/src/code-embed/source'
import { boardWiring, wiredLabel } from '../src/shared/wiring-pins'
import type { RobotDefinition } from '../src/shared/robot'

const PICO = BUILTIN_BOARDS.find((b) => b.id === 'pico2w')!

const ROBOT: RobotDefinition = {
  board: 'pico2w',
  parts: [
    { id: 'servo1', lib: 'kev', part: 'sg90', label: 'Servo 1' },
    { id: 'buzz', lib: 'kev', part: 'buzzer' },
    { id: 'dist', lib: 'kev', part: 'hcsr04', label: 'Range finder' }
  ],
  connections: [
    { id: 'w1', from: 'board.GP15', to: 'servo1.SIG', net: 'signal' },
    { id: 'w2', from: 'board.VBUS', to: 'servo1.VCC', net: 'vcc' },
    { id: 'w3', from: 'servo1.GND', to: 'board.GND', net: 'gnd' },
    // A joined net: the buzzer hangs off the range finder's trigger wire.
    { id: 'w4', from: 'board.GP2', to: 'dist.TRIG', net: 'signal' },
    { id: 'w5', from: 'dist.TRIG', to: 'buzz.IN', net: 'signal' },
    { id: 'w6', from: 'board.GP3', to: 'dist.ECHO', net: 'signal' }
  ]
}

describe('what a project wires to each board pin (#1320)', () => {
  it('follows wires from the board to the parts, through joined nets', () => {
    const wired = boardWiring(ROBOT)
    expect(wired.get('GP15')).toEqual([{ part: 'servo1', label: 'Servo 1', pin: 'SIG', net: 'signal', wires: ['w1'] }])
    expect(wiredLabel(wired.get('GP2') ?? [])).toBe('Range finder, buzzer')
    expect(wired.get('GP2')?.[0].wires).toEqual(['w4', 'w5'])
    expect(wired.has('GP4')).toBe(false)
  })

  it('a wire on the carrier a board is seated in counts as the board pin', () => {
    const wired = boardWiring({
      board: 'pico2w',
      boardMountedOn: 'base',
      parts: [
        { id: 'base', lib: 'kev', part: 'explorer', label: 'Explorer base' },
        { id: 'led', lib: 'kev', part: 'led', label: 'Red LED' }
      ],
      connections: [{ id: 'w1', from: 'base.GP7', to: 'led.A' }]
    })
    expect(wiredLabel(wired.get('GP7') ?? [])).toBe('Red LED')
  })

  it('survives junk', () => {
    expect(boardWiring(null).size).toBe(0)
    expect(boardWiring({ parts: [], connections: [{ id: 'x', from: 'nodot', to: '' }] }).size).toBe(0)
  })

  it('keys the wiring by the strip\'s pin ids and leaves power out of the signal pins', () => {
    const wiring = projectWiring(ROBOT, PICO)
    expect([...wiring.byPin.keys()].sort()).toContain('GP15')
    expect(wiring.signalPins.sort()).toEqual(['GP15', 'GP2', 'GP3'])
  })

  it('says where the code and the wiring disagree', () => {
    const code = 'from machine import Pin, PWM\nservo = PWM(Pin(15))\nled = Pin("LED", Pin.OUT)\nbtn = Pin(14, Pin.IN)\n'
    const mismatch = wiringMismatch(pinsInCode(code, PICO).pins, projectWiring(ROBOT, PICO))
    expect(mismatch.unwired).toEqual(['GP14'])
    expect(mismatch.unused.sort()).toEqual(['GP2', 'GP3'])
  })
})

describe('project and file-tab parameters (#1320)', () => {
  it('reads project= as digits only', () => {
    expect(parseEmbedParams('?code=x&project=42').project).toBe('42')
    expect(parseEmbedParams('?code=x&project=4/../2').project).toBeNull()
    expect(parseEmbedParams('?code=x').project).toBeNull()
  })

  it('reads paths= as tabs, the first (or path=) opening', () => {
    const a = parseEmbedParams('?repo=kev/bot&paths=main.py,lib/servo.py,../x.py')
    expect(a.source).toMatchObject({ kind: 'repo', path: 'main.py', paths: ['main.py', 'lib/servo.py'] })
    const b = parseEmbedParams('?repo=kev/bot&path=lib/servo.py&paths=main.py,lib/servo.py')
    expect(b.source).toMatchObject({ path: 'lib/servo.py', paths: ['lib/servo.py', 'main.py'] })
    const c = parseEmbedParams('?repo=kev/bot&path=main.py')
    expect(c.source).not.toHaveProperty('paths')
  })

  it('loads every tab from the same ref, leaving out one that is missing', async () => {
    const seen: string[] = []
    const fetcher: Fetcher = async (url) => {
      seen.push(url)
      const ok = !url.includes('/main/') && !url.endsWith('gone.py')
      return { ok, status: ok ? 200 : 404, text: async () => `# ${url.split('/').pop()}` }
    }
    const { source } = parseEmbedParams('?repo=kev/bot&paths=main.py,lib/servo.py,gone.py')
    const program = await loadProgram(source, fetcher)
    expect(program.name).toBe('main.py')
    expect(program.files?.map((f) => f.name)).toEqual(['main.py', 'lib/servo.py'])
    expect(program.files?.[1].code).toBe('# servo.py')
    expect(seen.some((u) => u.includes('/master/lib/servo.py'))).toBe(true)
  })
})
