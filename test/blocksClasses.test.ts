import { describe, it, expect, beforeEach } from 'vitest'
import * as Blockly from 'blockly/core'
import 'blockly/blocks'
import { generateProgram } from '../src/renderer/src/lib/blocks/generator'
import {
  blockDefinition,
  installBlockDefinitions,
  resetBlockRegistry
} from '../src/renderer/src/lib/blocks/registry'
import { installCorePalette } from '../src/renderer/src/lib/blocks/palette'
import { pythonToBlocks } from '../src/renderer/src/lib/blocks/python-to-blocks'

/**
 * CLASSES, METHODS AND `@property` (W6, #1093, epic #1086).
 * =============================================================================
 *
 * **The single biggest theme in the corpus — 32.8% of all grey lines** once W1's
 * `self.` assignments and calls are counted with it: 2,692 raw lines of nested
 * `def` across 53 projects, 604 `class` headers across 46, 340 decorators
 * across 29.
 *
 * The shape is set by Blockly, not by the reader. `procedures_defnoreturn` is a
 * HAT, and a hat cannot nest — which is exactly why #1063 stopped hoisting
 * methods out of their class and left the whole thing as a raw suite instead (a
 * class was losing its header while its twelve methods walked off to become
 * twelve top-level functions). So a class block with a statement input, methods
 * that are ordinary stackable blocks, `self` as a block of its own rather than a
 * workspace variable, and `@property` as a setting on the method.
 */

beforeEach(() => {
  resetBlockRegistry()
  installCorePalette()
  installBlockDefinitions()
})

function regenerate(source: string): string {
  const { workspace } = pythonToBlocks(source)
  const ws = new Blockly.Workspace()
  Blockly.serialization.workspaces.load(workspace as never, ws)
  return generateProgram(ws).code
}

function roundTrips(source: string): void {
  expect(regenerate(source)).toBe(source)
}

function blocks(source: string): Record<string, unknown>[] {
  const { workspace } = pythonToBlocks(source)
  const out: Record<string, unknown>[] = []
  const walk = (block: Record<string, unknown> | undefined): void => {
    if (!block) return
    out.push(block)
    for (const input of Object.values((block.inputs ?? {}) as Record<string, unknown>)) {
      walk((input as { block?: Record<string, unknown> }).block)
    }
    walk((block.next as { block?: Record<string, unknown> } | undefined)?.block)
  }
  const roots = (workspace as { blocks?: { blocks?: Record<string, unknown>[] } }).blocks?.blocks
  for (const block of roots ?? []) walk(block)
  return out
}

const types = (source: string): string[] => blocks(source).map((b) => b.type as string)
const one = (source: string, type: string): Record<string, unknown> | undefined =>
  blocks(source).find((b) => b.type === type)

const MOTOR = [
  'class Motor:',
  '    """One brushed motor."""',
  '',
  '    def __init__(self, forward, backward):',
  '        self.forward = forward',
  '        self.backward = backward',
  '        self.speed = 0',
  '',
  '    @property',
  '    def running(self):',
  '        return self.speed != 0',
  '',
  '    def drive(self, speed):',
  '        self.speed = speed',
  '        self.forward.duty_u16(speed)',
  ''
].join('\n')

describe('a class holds its body', () => {
  it('reads the header as a block, not as a grey suite', () => {
    expect(types(MOTOR)).toContain('snakie_class')
    expect(types(MOTOR)).not.toContain('snakie_python_suite')
    expect(one(MOTOR, 'snakie_class')!.fields).toEqual({ NAME: 'Motor', BASES: '' })
  })

  it('stacks its methods inside it', () => {
    const klass = one(MOTOR, 'snakie_class')!
    const body = (klass.inputs as Record<string, { block: Record<string, unknown> }>).BODY.block
    // The docstring first, then the methods chained under it.
    expect(body.type).toBe('snakie_python_docstring')
    const chained: string[] = []
    for (
      let b: Record<string, unknown> | undefined = body;
      b;
      b = (b.next as { block?: Record<string, unknown> } | undefined)?.block
    ) {
      chained.push(b.type as string)
    }
    expect(chained.filter((t) => t === 'snakie_method')).toHaveLength(3)
  })

  it('round-trips the whole thing', () => {
    roundTrips(MOTOR)
  })

  it('reports no grey at all', () => {
    const { report } = pythonToBlocks(MOTOR)
    expect(report.raw).toBe(0)
    expect(report.rawSockets).toBe(0)
  })
})

describe('inheritance', () => {
  it('keeps a single base', () => {
    const src = ['class Rover(Wheels):', '    def go(self):', '        print(1)', ''].join('\n')
    expect(one(src, 'snakie_class')!.fields).toEqual({ NAME: 'Rover', BASES: '(Wheels)' })
    roundTrips(src)
  })

  it('keeps several, and a keyword one', () => {
    for (const bases of ['(Base, Mixin)', '(object)', '(Base, metaclass=Meta)']) {
      const src = [`class Thing${bases}:`, '    def go(self):', '        print(1)', ''].join('\n')
      expect(one(src, 'snakie_class')!.fields, bases).toEqual({ NAME: 'Thing', BASES: bases })
      roundTrips(src)
    }
  })
})

describe('`self` is never a workspace variable', () => {
  it('reads as a block of its own', () => {
    // Blockly variables are global to the workspace and renameable from a
    // dropdown, so a learner renaming `self` in one method would rename it in
    // twelve and generate a class that no longer works.
    expect(types(MOTOR)).toContain('snakie_self')
    const { workspace } = pythonToBlocks(MOTOR)
    const declared = (workspace as { variables?: { name: string }[] }).variables ?? []
    expect(declared.map((v) => v.name)).not.toContain('self')
  })

  it('is not declared by a method’s parameter list either', () => {
    // The parameters are a FIELD, not workspace variables — which is also what
    // lets a signature `procedures_def` cannot hold come back exactly.
    const { workspace } = pythonToBlocks('class T:\n    def go(self, speed):\n        print(1)\n')
    const declared = (workspace as { variables?: { name: string }[] }).variables ?? []
    expect(declared.map((v) => v.name)).not.toContain('self')
  })

  it('leaves `self = x` alone rather than declaring one by the back door', () => {
    expect(types('self = other\n')).toEqual(['snakie_python_statement'])
    roundTrips('self = other\n')
  })
})

describe('decorators', () => {
  it('reads @property as a setting on the method', () => {
    const src = ['class T:', '    @property', '    def x(self):', '        return 1', ''].join('\n')
    expect(one(src, 'snakie_method')!.fields).toMatchObject({ DECORATOR: 'property' })
    expect(types(src)).not.toContain('snakie_python_statement')
    roundTrips(src)
  })

  it('reads @staticmethod and @classmethod', () => {
    for (const decorator of ['staticmethod', 'classmethod']) {
      const src = ['class T:', `    @${decorator}`, '    def x(cls):', '        return 1', ''].join(
        '\n'
      )
      expect(one(src, 'snakie_method')!.fields, decorator).toMatchObject({ DECORATOR: decorator })
      roundTrips(src)
    }
  })

  it('counts the decorator line, so the report stays honest', () => {
    const src = ['class T:', '    @property', '    def x(self):', '        return 1', ''].join('\n')
    const { report } = pythonToBlocks(src)
    expect(report.total).toBe(4)
    expect(report.raw).toBe(0)
  })

  it('leaves a decorator it does not know alone, with its def under it', () => {
    const src = ['@app.route("/")', 'def index():', '    return 1', ''].join('\n')
    expect(types(src)).toContain('snakie_python_statement')
    roundTrips(src)
  })
})

describe('a method’s own signature', () => {
  it('keeps defaults, which `procedures_def` could never hold (#1063)', () => {
    const src = [
      'class T:',
      '    def load(self, path, flip_x=None):',
      '        print(path)',
      ''
    ].join('\n')
    expect(one(src, 'snakie_method')!.fields).toMatchObject({ PARAMS: 'self, path, flip_x=None' })
    roundTrips(src)
  })

  it('keeps `*args` and `**kwargs`', () => {
    const src = ['class T:', '    def go(self, *args, **kwargs):', '        print(1)', ''].join(
      '\n'
    )
    roundTrips(src)
  })

  it('reads a trailing return as the return block, not as a def socket', () => {
    const src = ['class T:', '    def double(self, n):', '        return n * 2', ''].join('\n')
    expect(types(src)).toContain('snakie_return')
    roundTrips(src)
  })

  it('reads a top-level `def` with a default as a PROCEDURE block now (#1134)', () => {
    // It used to land on the method block, because dropping the default would
    // have changed every call and Blockly's mutator had nowhere to put it.
    // #1134 gave the procedure block a field for exactly that, so `path` keeps
    // its caller socket and `flip_x=None` keeps its default.
    const src = ['def load(path, flip_x=None):', '    print(path)', ''].join('\n')
    expect(types(src)).toContain('procedures_defnoreturn')
    expect(types(src)).not.toContain('snakie_method')
    roundTrips(src)
  })

  it('still sends a signature it cannot split to the method block', () => {
    // A trailing comma is the learner's text and no block records it.
    const src = ['def load(path,):', '    print(path)', ''].join('\n')
    expect(types(src)).toContain('snakie_method')
    roundTrips(src)
  })
})

describe('what must not change', () => {
  it('a plain top-level `def` is still a procedure block', () => {
    const src = ['def go(n):', '    print(n)', '', 'go(1)', ''].join('\n')
    expect(types(src)).toContain('procedures_defnoreturn')
    expect(types(src)).toContain('procedures_callnoreturn')
    expect(types(src)).not.toContain('snakie_method')
    roundTrips(src)
  })

  it('a top-level `def`’s docstring is still its comment bubble', () => {
    const src = ['def distance():', '    """Returns the distance."""', '    return 1', ''].join(
      '\n'
    )
    expect(types(src)).toContain('procedures_defreturn')
    roundTrips(src)
  })
})

describe('the epic’s success test', () => {
  it('opens a real robot program as classes rather than a grey wall', () => {
    // `PicoCrab2/crab.py` in miniature: classes, inheritance, `@property`,
    // methods, attribute assignment, calls on attributes, an early return.
    const src = [
      'import time',
      '',
      '',
      'class Leg:',
      '    """One leg of the crab, two servos deep."""',
      '',
      '    def __init__(self, hip, knee):',
      '        self.hip = hip',
      '        self.knee = knee',
      '        self.down = True',
      '',
      '    @property',
      '    def lifted(self):',
      '        return not self.down',
      '',
      '    def lift(self):',
      '        if self.lifted:',
      '            return',
      '        self.knee.angle(120)',
      '        self.down = False',
      '',
      '',
      'class Crab(object):',
      '    def __init__(self, legs):',
      '        self.legs = legs',
      '        self.step_delay = 0.2',
      '',
      '    def walk(self, steps):',
      '        for _ in range(steps):',
      '            for leg in self.legs:',
      '                leg.lift()',
      '                time.sleep(self.step_delay)',
      ''
    ].join('\n')
    const { report } = pythonToBlocks(src)
    expect(report.raw).toBe(0)
    expect(report.rawSockets).toBe(0)
    roundTrips(src)
  })
})

/**
 * `__init__` SEED AND `create <Class>(…)` (B5, #1224, epic #1206).
 * =============================================================================
 *
 * The two halves of using a class: the constructor a class arrives with, and the
 * line that makes one. The seed is a TOOLBOX preset, so it is what the flyout
 * hands out and nothing about a class read from a file changes; the create
 * block only ever claims a name this file has a `class` header for.
 */
describe('creating an instance (B5, #1224)', () => {
  const ROBOT = [
    'class Robot:',
    '    def __init__(self, name, speed):',
    '        self.name = name',
    '        self.speed = speed',
    '',
    ''
  ].join('\n')

  /** A definition off the registry, which the palette has installed above. */
  const definition = (type: string): NonNullable<ReturnType<typeof blockDefinition>> => {
    const def = blockDefinition(type)
    expect(def).toBeTruthy()
    return def!
  }

  it('reads `Robot("Bob", speed=3)` as the create block, keywords and all', () => {
    const src = `${ROBOT}robot = Robot('Bob', speed=3)\n`
    const made = one(src, 'snakie_new_instance')
    expect(made).toBeTruthy()
    expect((made?.fields as Record<string, string>).CLASS).toBe('Robot')
    // The keyword's NAME is the box's and its value is the socket's — the same
    // split the generator writes (#1163).
    expect((made?.fields as Record<string, string>).NAME1).toBe('speed')
    expect(made?.extraState).toEqual({ args: 2 })
  })

  it('round-trips the line it was built from', () => {
    roundTrips(`${ROBOT}robot = Robot('Bob', speed=3)\n`)
    roundTrips(`${ROBOT}robot = Robot()\n`)
  })

  it('reads one inside a larger expression', () => {
    expect(types(`${ROBOT}robots = [Robot('Bob', 1), Robot('Ann', 2)]\n`)).toContain(
      'snakie_new_instance'
    )
  })

  it('claims only a name this file defines as a class', () => {
    // `sorted(xs)` and `Robot("Bob")` are the same shape; only the `class`
    // header tells them apart, so a call to anything else is untouched.
    expect(types(`${ROBOT}x = sorted(names)\n`)).not.toContain('snakie_new_instance')
    expect(types("x = Robot('Bob')\n")).not.toContain('snakie_new_instance')
  })

  it('leaves a call with more arguments than the block can hold raw', () => {
    const many = Array.from({ length: 9 }, (_, i) => String(i)).join(', ')
    expect(types(`${ROBOT}robot = Robot(${many})\n`)).not.toContain('snakie_new_instance')
  })

  it('seeds a class dragged from the drawer with an `__init__`', () => {
    const seed = (
      definition('snakie_class').toolbox as {
        inputs: { BODY: { block: { type: string; fields: Record<string, string> } } }
      }
    ).inputs.BODY.block
    expect(seed.type).toBe('snakie_method')
    expect(seed.fields.NAME).toBe('__init__')
    expect(seed.fields.PARAMS).toBe('self')
  })

  it('generates the seeded class as `class Robot:` with its constructor', () => {
    const ws = new Blockly.Workspace()
    Blockly.serialization.workspaces.load(
      {
        blocks: {
          languageVersion: 0,
          blocks: [
            {
              type: 'snakie_class',
              fields: { NAME: 'Robot', BASES: '' },
              inputs: {
                BODY: {
                  block: {
                    type: 'snakie_method',
                    fields: { DECORATOR: 'NONE', KIND: 'SYNC', NAME: '__init__', PARAMS: 'self' }
                  }
                }
              }
            }
          ]
        }
      } as never,
      ws
    )
    expect(generateProgram(ws).code).toBe('class Robot:\n    def __init__(self):\n        pass\n')
  })

  it('is an advanced block', () => {
    expect(definition('snakie_new_instance').level).toBe('advanced')
  })
})
