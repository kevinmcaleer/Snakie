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
    // Two methods and the `@property`, which is a property block of its own
    // since B3 (#1222) rather than a third method with a decorator on it.
    expect(chained.filter((t) => t === 'snakie_method')).toHaveLength(2)
    expect(chained.filter((t) => t === 'snakie_property')).toHaveLength(1)
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
  /** The decorator list the reader put on the one method block in `src`. */
  const decorators = (src: string): unknown =>
    (one(src, 'snakie_method')!.extraState as { decorators?: unknown } | undefined)?.decorators

  it('reads @property as a property block of its own (B3, #1222)', () => {
    const src = ['class T:', '    @property', '    def x(self):', '        return 1', ''].join('\n')
    // It used to be the method block with DECORATOR: 'property' on it. B3 gave
    // the pair a block that can hold the `@x.setter` half as well, and a lone
    // getter is that block with the setter switched off — see
    // `blocksProperty.test.ts`. The method block's own setting is untouched,
    // and is still what a `@property` this one refuses falls back to.
    expect(one(src, 'snakie_property')!.fields).toMatchObject({ NAME: 'x', HAS_SETTER: false })
    expect(types(src)).not.toContain('snakie_python_statement')
    roundTrips(src)
  })

  it('reads @staticmethod and @classmethod', () => {
    for (const decorator of ['staticmethod', 'classmethod']) {
      const src = ['class T:', `    @${decorator}`, '    def x(cls):', '        return 1', ''].join('\n')
      expect(decorators(src), decorator).toEqual([decorator])
      roundTrips(src)
    }
  })

  it('counts the decorator line, so the report stays honest', () => {
    const src = ['class T:', '    @property', '    def x(self):', '        return 1', ''].join('\n')
    const { report } = pythonToBlocks(src)
    expect(report.total).toBe(4)
    expect(report.raw).toBe(0)
  })

  // --- A2 (#1216): ANY decorator, not the three that had a dropdown --------

  it('reads a dotted decorator rather than leaving it grey', () => {
    const src = [
      'import micropython',
      '',
      'class T:',
      '    @micropython.native',
      '    def x(self):',
      '        return 1',
      ''
    ].join('\n')
    expect(decorators(src)).toEqual(['micropython.native'])
    expect(types(src)).not.toContain('snakie_python_statement')
    roundTrips(src)
  })

  it('takes a decorator with arguments verbatim, brackets in strings and all', () => {
    const src = ['@app.route("/(a)", methods=["GET"])', 'def index():', '    return 1', ''].join('\n')
    expect(decorators(src)).toEqual(['app.route("/(a)", methods=["GET"])'])
    expect(types(src)).not.toContain('snakie_python_statement')
    roundTrips(src)
  })

  it('keeps several decorators, in the order they are written', () => {
    const src = [
      'import micropython',
      '',
      'class T:',
      '    @staticmethod',
      '    @micropython.native',
      '    def x():',
      '        return 1',
      ''
    ].join('\n')
    expect(decorators(src)).toEqual(['staticmethod', 'micropython.native'])
    expect(types(src)).not.toContain('snakie_python_statement')
    expect(pythonToBlocks(src).report.raw).toBe(0)
    roundTrips(src)
  })

  it('reads a decorator separated from its def by a comment', () => {
    const src = ['@app.route("/")', '# the home page', 'def index():', '    return 1', ''].join('\n')
    expect(decorators(src)).toEqual(['app.route("/")'])
    expect(types(src)).not.toContain('snakie_python_statement')
  })

  it('does not hoist a decorated top-level def away from its decorator', () => {
    const src = ['@app.route("/")', 'def index():', '    return 1', ''].join('\n')
    expect(types(src)).not.toContain('procedures_defnoreturn')
    expect(types(src)).toContain('snakie_method')
  })

  it('leaves a decorator with no def under it alone', () => {
    const src = ['@something', 'x = 1', ''].join('\n')
    expect(types(src)).toContain('snakie_python_statement')
    roundTrips(src)
  })

  it('reads a @property / @x.setter pair written with no blank line (B3, #1222)', () => {
    const src = [
      'class T:',
      '    @property',
      '    def x(self):',
      '        return self._x',
      '    @x.setter',
      '    def x(self, value):',
      '        self._x = value',
      ''
    ].join('\n')
    // A2 (#1216) read this as two methods with a decorator each, and said so,
    // because B3 had not landed. It has, and it folds the pair ONLY when the
    // `@x.setter` has the one blank line above it that the generator writes.
    // With the halves written tight, as here, the getter becomes the property
    // block and the setter stays a method carrying its own decorator — which
    // is lossless, as the round trip below shows.
    expect(one(src, 'snakie_property')!.fields).toMatchObject({ NAME: 'x', HAS_SETTER: false })
    const methods = blocks(src).filter((b) => b.type === 'snakie_method')
    expect(methods.map((m) => (m.extraState as { decorators: string[] }).decorators)).toEqual([
      ['x.setter']
    ])
    roundTrips(src)
  })

  it('folds the pair into one block when the blank line is there (B3, #1222)', () => {
    const src = [
      'class T:',
      '    @property',
      '    def x(self):',
      '        return self._x',
      '',
      '    @x.setter',
      '    def x(self, value):',
      '        self._x = value',
      ''
    ].join('\n')
    expect(blocks(src).filter((b) => b.type === 'snakie_method')).toHaveLength(0)
    expect(one(src, 'snakie_property')!.fields).toMatchObject({ NAME: 'x', HAS_SETTER: true })
    roundTrips(src)
  })
})

describe('a method’s own signature', () => {
  it('keeps defaults, which `procedures_def` could never hold (#1063)', () => {
    const src = ['class T:', '    def load(self, path, flip_x=None):', '        print(path)', ''].join('\n')
    const block = one(src, 'snakie_method')!
    // Since B2 (#1221) the signature is a real list: `self` is the block's
    // fixed lead, `path` is a name field, and the default goes in the extras
    // field `def` has had since #1134 — one mechanism, not two.
    expect(block.extraState).toEqual({ lead: 'self', params: ['path'] })
    expect(block.fields).toMatchObject({ EXTRAS: 'flip_x=None' })
    roundTrips(src)
  })

  it('splits `*args` and `**kwargs` into the extras field', () => {
    const src = ['class T:', '    def go(self, *args, **kwargs):', '        print(1)', ''].join('\n')
    const block = one(src, 'snakie_method')!
    expect(block.extraState).toEqual({ lead: 'self', params: [] })
    expect(block.fields).toMatchObject({ EXTRAS: '*args, **kwargs' })
  })

  it('takes `cls` as the lead of a class method, and no lead at all for a static one', () => {
    const cls = ['class T:', '    @classmethod', '    def make(cls, n):', '        return n', ''].join('\n')
    expect(one(cls, 'snakie_method')!.extraState).toEqual({
      lead: 'cls',
      params: ['n'],
      // The decorator rides on the extra state as a list since A1 (#1215).
      decorators: ['classmethod']
    })
    roundTrips(cls)
    const stat = ['class T:', '    @staticmethod', '    def add(a, b):', '        return a', ''].join('\n')
    expect(one(stat, 'snakie_method')!.extraState).toEqual({
      lead: 'none',
      params: ['a', 'b'],
      decorators: ['staticmethod']
    })
    roundTrips(stat)
  })

  it('never invents a lead for a signature that has none', () => {
    const src = ['class T:', '    def go():', '        print(1)', ''].join('\n')
    expect(one(src, 'snakie_method')!.extraState).toEqual({ lead: 'none', params: [] })
    roundTrips(src)
  })

  it('gives up the lead rather than let a decorator rewrite it', () => {
    // `@classmethod` on a `def x(self)` is somebody's code, and the block
    // would otherwise write `cls` into it.
    const src = ['class T:', '    @classmethod', '    def go(self):', '        print(1)', ''].join('\n')
    expect(one(src, 'snakie_method')!.extraState).toEqual({
      lead: 'none',
      params: ['self'],
      decorators: ['classmethod']
    })
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
        inputs: {
          BODY: {
            block: {
              type: string
              fields: Record<string, string>
              extraState: Record<string, unknown>
            }
          }
        }
      }
    ).inputs.BODY.block
    expect(seed.type).toBe('snakie_method')
    expect(seed.fields.NAME).toBe('__init__')
    // The rebuilt method block holds `self` as its fixed lead (#1221), not as
    // text in the old free-text `PARAMS` field.
    expect(seed.extraState).toEqual({ lead: 'self', params: [] })
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
                    fields: { DECORATOR: 'NONE', KIND: 'SYNC', NAME: '__init__' },
                    extraState: { lead: 'self', params: [] }
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

/**
 * THE OLD `PARAMS` FIELD, MIGRATED (B2, #1221, epic #1206).
 * =============================================================================
 *
 * Every workspace saved before #1221 carries the whole signature as one string
 * and no parameter list at all. The block keeps the field, invisible, and
 * spends it the moment a file sets it: the same splitter the reader uses turns
 * it into the fixed lead, the name fields and the extras field — so an old file
 * opens, generates exactly the Python it generated before, and is saved back in
 * the new shape.
 */
describe('a workspace saved before the rebuild', () => {
  /** A method block as it was serialised before #1221, loaded into a workspace. */
  function legacy(fields: Record<string, string>): Blockly.Block {
    const ws = new Blockly.Workspace()
    Blockly.serialization.workspaces.load(
      {
        blocks: {
          languageVersion: 0,
          blocks: [{ type: 'snakie_method', id: 'm', fields }]
        }
      },
      ws
    )
    return ws.getBlockById('m')!
  }

  /** The Python a loaded block generates, body and all. */
  const code = (block: Blockly.Block): string => generateProgram(block.workspace).code

  it('splits the signature into the lead, the names and the extras', () => {
    const block = legacy({ NAME: 'load', PARAMS: 'self, path, flip_x=None', DECORATOR: 'NONE' })
    expect(block.getFieldValue('PARAM0')).toBe('path')
    expect(block.getFieldValue('EXTRAS')).toBe('flip_x=None')
    expect(code(block)).toBe('def load(self, path, flip_x=None):\n    pass\n')
  })

  it('writes the same Python the old field did', () => {
    for (const params of ['self', 'self, speed', 'self, *args, **kwargs', 'cls, n', '']) {
      const block = legacy({ NAME: 'go', PARAMS: params })
      expect(code(block), params).toBe(`def go(${params}):\n    pass\n`)
    }
  })

  it('is saved back in the new shape, so the migration never runs twice', () => {
    const block = legacy({ NAME: 'go', PARAMS: 'self, speed' })
    const saved = Blockly.serialization.blocks.save(block) as unknown as Record<string, unknown>
    expect(saved.extraState).toEqual({ lead: 'self', params: ['speed'] })
    // Nothing left to re-run: a second pass over a learner's edits would put
    // the old signature back.
    expect((saved.fields as Record<string, string>).PARAMS).toBeUndefined()
  })

  it('keeps a signature nobody can split, trailing comma and all', () => {
    const block = legacy({ NAME: 'load', PARAMS: 'path,' })
    expect(code(block)).toBe('def load(path,):\n    pass\n')
  })

  it('keeps the decorator and the async setting working over the top', () => {
    const block = legacy({ NAME: 'x', PARAMS: 'self', DECORATOR: 'property', KIND: 'ASYNC' })
    expect(code(block)).toBe('@property\nasync def x(self):\n    pass\n')
  })
})

describe('the method block a learner drags out', () => {
  /** A fresh method block, with the state a saved file would give it. */
  function fresh(state?: Record<string, unknown>): Blockly.Block {
    const ws = new Blockly.Workspace()
    Blockly.serialization.workspaces.load(
      {
        blocks: {
          languageVersion: 0,
          blocks: [{ type: 'snakie_method', id: 'm', ...(state ? { extraState: state } : {}) }]
        }
      },
      ws
    )
    return ws.getBlockById('m')!
  }

  it('starts as `def go(self):`', () => {
    expect(generateProgram(fresh().workspace).code).toBe('def go(self):\n    pass\n')
  })

  it('shows `self` as a label, not as a field a learner can rename', () => {
    // Renaming it here would leave every `self.` block in the body meaning
    // nothing — which is the whole reason `self` is not a variable (#1093).
    const block = fresh()
    expect(block.getField('SELF')).toBeNull()
    expect(block.getFieldValue('PARAM0')).toBeNull()
  })

  it('follows the decorator: `cls` for a class method, nothing for a static one', () => {
    const block = fresh({ lead: 'self', params: ['n'] })
    block.setFieldValue('classmethod', 'DECORATOR')
    expect(generateProgram(block.workspace).code).toBe('@classmethod\ndef go(cls, n):\n    pass\n')
    block.setFieldValue('staticmethod', 'DECORATOR')
    expect(generateProgram(block.workspace).code).toBe('@staticmethod\ndef go(n):\n    pass\n')
  })

  it('keeps the names already typed in when the row is rebuilt', () => {
    const block = fresh({ lead: 'self', params: ['speed'] })
    block.setFieldValue('fast', 'PARAM0')
    block.setFieldValue('classmethod', 'DECORATOR')
    expect(block.getFieldValue('PARAM0')).toBe('fast')
  })

  it('builds `class Robot:` with an `__init__` that has a default', () => {
    // #1221's "done when", BUILT rather than read: the class block, a method
    // inside it, a name field and the extras row.
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
                    fields: { NAME: '__init__', EXTRAS: 'speed=3' },
                    extraState: { lead: 'self', params: ['name'] }
                  }
                }
              }
            }
          ]
        }
      },
      ws
    )
    expect(generateProgram(ws).code).toBe(
      'class Robot:\n    def __init__(self, name, speed=3):\n        pass\n'
    )
  })
})
