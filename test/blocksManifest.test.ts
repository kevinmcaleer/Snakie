import { describe, it, expect } from 'vitest'
import {
  BLOCKS_MANIFEST_VERSION,
  blocksManifestToYaml,
  normaliseBlocksManifest,
  parseBlocksManifest,
  renderTemplate,
  templatePlaceholders
} from '../src/shared/blocks-manifest'

/**
 * `blocks.yml` — THE MANIFEST SCHEMA (#1017, epic #1007).
 * =============================================================================
 *
 * The parser is the gate a stranger's file passes through before any of it
 * reaches a child's program, so it is tested as a gate: what gets in, what is
 * turned away, and — the rule epic #856 actually cares about — whether anything
 * is ever turned away in SILENCE.
 *
 * The bar for a warning is deliberately low. The person who writes a part's
 * `blocks.yml` is almost never the person who will see it not work, so a typo
 * that costs a block has to be findable from the app rather than from a
 * maintainer reading YAML over somebody's shoulder.
 */

const ONE_BLOCK = `
version: 1
blocks:
  - id: read
    message: distance in cm
    shape: value
    output: Number
    code: sensor.read()
`

describe('parseBlocksManifest', () => {
  it('reads a minimal block', () => {
    const { manifest, warnings } = parseBlocksManifest(ONE_BLOCK)
    expect(warnings).toEqual([])
    expect(manifest.version).toBe(1)
    expect(manifest.blocks).toHaveLength(1)
    expect(manifest.blocks[0]).toMatchObject({
      id: 'read',
      shape: 'value',
      output: 'Number',
      code: 'sensor.read()'
    })
  })

  it('treats a bare list of blocks as a manifest', () => {
    // The shape an author writes first. Refusing it to insist on a two-line
    // header would be pedantry with a cost.
    const { manifest } = parseBlocksManifest(`
- id: beep
  message: beep
  code: "buzzer.beep()"
`)
    expect(manifest.blocks.map((b) => b.id)).toEqual(['beep'])
  })

  it('an empty or blank file is an empty manifest, not an error', () => {
    expect(parseBlocksManifest('').manifest.blocks).toEqual([])
    expect(parseBlocksManifest('# just a comment\n').manifest.blocks).toEqual([])
  })

  it('infers a value block from `output` alone', () => {
    const { manifest } = parseBlocksManifest(`
blocks:
  - id: temp
    message: temperature
    output: Number
    code: sensor.temp()
`)
    expect(manifest.blocks[0].shape).toBe('value')
  })

  it('defaults to a statement block', () => {
    const { manifest } = parseBlocksManifest(`
blocks:
  - id: go
    message: go
    code: "robot.go()"
`)
    expect(manifest.blocks[0].shape).toBe('statement')
    expect(manifest.blocks[0].output).toBeUndefined()
  })
})

describe('schema safety — nothing is eaten in silence (epic #856)', () => {
  it('warns about an unknown block field, and keeps the block', () => {
    const { manifest, warnings } = parseBlocksManifest(`
blocks:
  - id: go
    message: go
    code: "robot.go()"
    helpUrl: https://example.invalid/go
`)
    expect(manifest.blocks).toHaveLength(1)
    expect(warnings.join('\n')).toContain('helpUrl')
  })

  it('warns about an unknown argument field', () => {
    const { warnings } = parseBlocksManifest(`
blocks:
  - id: go
    message: go %1
    code: "robot.go({N})"
    args:
      - name: N
        kind: number
        maximum: 10
`)
    expect(warnings.join('\n')).toContain('maximum')
  })

  it('warns about an unknown top-level field', () => {
    const { warnings } = parseBlocksManifest(`
version: 1
author: someone
blocks: []
`)
    expect(warnings.join('\n')).toContain('author')
  })

  it('names the block in every warning it can', () => {
    const { warnings } = parseBlocksManifest(`
blocks:
  - id: mystery
    message: mystery
    code: "x({NOPE})"
`)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('"mystery"')
    expect(warnings[0]).toContain('{NOPE}')
  })

  it('accepts a manifest from the future, and says so', () => {
    const { manifest, warnings } = parseBlocksManifest(`
version: ${BLOCKS_MANIFEST_VERSION + 1}
blocks:
  - id: go
    message: go
    code: "robot.go()"
`)
    // Still loaded: a forward-compatible addition should not turn a part's
    // whole palette off.
    expect(manifest.blocks).toHaveLength(1)
    expect(warnings.join('\n')).toContain('newer than this Snakie understands')
  })
})

describe('blocks that are turned away', () => {
  const dropped = (yaml: string): { ids: string[]; warnings: string[] } => {
    const { manifest, warnings } = parseBlocksManifest(yaml)
    return { ids: manifest.blocks.map((b) => b.id), warnings }
  }

  it('drops a block whose template names an argument it has not got', () => {
    // The important one: a hole with nothing behind it would put a gap into
    // generated Python and then onto a board.
    const { ids, warnings } = dropped(`
blocks:
  - id: broken
    message: broken %1
    code: "go({SPEED})"
    args:
      - name: RATE
        kind: number
`)
    expect(ids).toEqual([])
    expect(warnings.join('\n')).toContain('{SPEED}')
  })

  it('drops a block whose message has no slot for an argument', () => {
    // A field with no `%n` is built and then never shown — a value the learner
    // cannot see or change, silently baked into their program.
    const { ids, warnings } = dropped(`
blocks:
  - id: hidden
    message: just words
    code: "go({SPEED})"
    args:
      - name: SPEED
        kind: number
`)
    expect(ids).toEqual([])
    expect(warnings.join('\n')).toContain('%1')
  })

  it('drops a block whose message uses a slot it has no argument for', () => {
    const { ids, warnings } = dropped(`
blocks:
  - id: overreach
    message: go %1 at %2
    code: "go({SPEED})"
    args:
      - name: SPEED
        kind: number
`)
    expect(ids).toEqual([])
    expect(warnings.join('\n')).toContain('%2')
  })

  it('drops a block with no id, message or code', () => {
    expect(dropped('blocks:\n  - message: x\n    code: "y()"\n').ids).toEqual([])
    expect(dropped('blocks:\n  - id: a\n    code: "y()"\n').ids).toEqual([])
    expect(dropped('blocks:\n  - id: a\n    message: x\n').ids).toEqual([])
  })

  it('drops a choice with no options', () => {
    const { ids, warnings } = dropped(`
blocks:
  - id: pick
    message: pick %1
    code: "go({MODE})"
    args:
      - name: MODE
        kind: choice
`)
    expect(ids).toEqual([])
    expect(warnings.join('\n')).toContain('no options')
  })

  it('drops the SECOND block with a duplicated id', () => {
    const { ids, warnings } = dropped(`
blocks:
  - id: go
    message: go
    code: "a()"
  - id: go
    message: go again
    code: "b()"
`)
    expect(ids).toEqual(['go'])
    expect(warnings.join('\n')).toContain('same id')
  })

  it('refuses a setup that refers to its own result', () => {
    const { ids, warnings } = dropped(`
blocks:
  - id: loop
    message: loop
    code: "{SETUP}.go()"
    setup:
      expr: "Thing({SETUP})"
`)
    expect(ids).toEqual([])
    expect(warnings.join('\n')).toContain('that IS the setup')
  })

  it('refuses {SETUP} on a block that declares none', () => {
    const { ids, warnings } = dropped(`
blocks:
  - id: orphan
    message: orphan
    code: "{SETUP}.go()"
`)
    expect(ids).toEqual([])
    expect(warnings.join('\n')).toContain('declares no setup')
  })
})

describe('argument forms', () => {
  it('reads both spellings of a choice', () => {
    const { manifest } = parseBlocksManifest(`
blocks:
  - id: pick
    message: pick %1
    code: "go({MODE})"
    args:
      - name: MODE
        kind: choice
        options:
          - [Fast, "'fast'"]
          - label: Slow
            value: "'slow'"
`)
    expect(manifest.blocks[0].args?.[0].options).toEqual([
      { label: 'Fast', value: "'fast'" },
      { label: 'Slow', value: "'slow'" }
    ])
  })

  it('reads a bare string import', () => {
    const { manifest } = parseBlocksManifest(`
blocks:
  - id: go
    message: go
    code: "time.sleep(1)"
    imports: [time]
`)
    expect(manifest.blocks[0].imports).toEqual([{ module: 'time' }])
  })

  it('drops a shadow pointing at a block that is not in the file', () => {
    // Blockly answers an unknown shadow type by throwing while the flyout opens,
    // so one bad reference would take the whole toolbox with it.
    const { manifest, warnings } = parseBlocksManifest(`
blocks:
  - id: read
    message: read %1
    code: "{OBJ}.read()"
    output: Number
    args:
      - name: OBJ
        kind: any
        shadow: nowhere
`)
    expect(manifest.blocks[0].args?.[0].shadow).toBeUndefined()
    expect(warnings.join('\n')).toContain('nowhere')
  })

  it('keeps a shadow that names a real block', () => {
    const { manifest, warnings } = parseBlocksManifest(`
blocks:
  - id: object
    message: the sensor
    output: Object
    code: sensor
  - id: read
    message: read %1
    output: Number
    code: "{OBJ}.read()"
    args:
      - name: OBJ
        kind: any
        shadow: object
`)
    expect(warnings).toEqual([])
    expect(manifest.blocks[1].args?.[0].shadow).toBe('object')
  })

  it('refuses a block shadow on a field', () => {
    const { warnings } = parseBlocksManifest(`
blocks:
  - id: a
    message: a
    code: x
  - id: go
    message: go %1
    code: "go({NAME})"
    args:
      - name: NAME
        kind: text-field
        shadow: a
`)
    expect(warnings.join('\n')).toContain('cannot have a block shadow')
  })
})

describe('templates', () => {
  it('finds every placeholder once, in order', () => {
    expect(templatePlaceholders('{A} and {B} and {A}')).toEqual(['A', 'B'])
  })

  it('fills the holes', () => {
    expect(renderTemplate('go({SPEED}, {DIR})', { SPEED: '100', DIR: "'left'" })).toBe(
      "go(100, 'left')"
    )
  })

  it('leaves an unknown hole empty rather than writing `undefined`', () => {
    expect(renderTemplate('go({NOPE})', {})).toBe('go()')
  })

  it('understands doubled braces as literal ones', () => {
    // An f-string, a dict and `format()` all need them, and a template that
    // cannot write a brace cannot write most real MicroPython.
    expect(renderTemplate('print(f"{{{V}}}")', { V: 'x' })).toBe('print(f"{x}")')
    expect(templatePlaceholders('{{ not a hole }}')).toEqual([])
  })

  it('ignores a brace that is not a placeholder', () => {
    expect(renderTemplate('d = {}', {})).toBe('d = {}')
    expect(renderTemplate('go({ bad name })', {})).toBe('go({ bad name })')
  })
})

describe('a manifest declares its dialect (#1039)', () => {
  const withScope = (scope: string): string => `
version: 1
blocks:
  - id: read
    message: distance in cm
    shape: value
    output: Number
    code: sensor.read()
    scope: ${scope}
`

  it('keeps a real scope', () => {
    const { manifest, warnings } = parseBlocksManifest(withScope('circuitpython'))
    expect(warnings).toEqual([])
    expect(manifest.blocks[0].scope).toBe('circuitpython')
  })

  it('drops `both`, which is the default anyway', () => {
    const { manifest, warnings } = parseBlocksManifest(withScope('both'))
    expect(warnings).toEqual([])
    expect(manifest.blocks[0].scope).toBeUndefined()
  })

  it('warns on a typo rather than scoping the block to a runtime that is not there', () => {
    // The failure mode this prevents: `scope: micropythn` silently becoming a
    // block nobody is ever offered, on any board.
    const { manifest, warnings } = parseBlocksManifest(withScope('micropythn'))
    expect(warnings).toEqual([
      'block "read": scope must be one of both, micropython, circuitpython — ignored'
    ])
    expect(manifest.blocks[0].scope).toBeUndefined()
  })
})

describe('a manifest declares its level (#1213, epic #1206)', () => {
  const withLevel = (level: string): string => `
version: 1
blocks:
  - id: read
    message: raw register
    shape: value
    output: Number
    code: sensor.read_reg(0)
    level: ${level}
`

  it('keeps an advanced block advanced', () => {
    const { manifest, warnings } = parseBlocksManifest(withLevel('advanced'))
    expect(warnings).toEqual([])
    expect(manifest.blocks[0].level).toBe('advanced')
  })

  it('drops `simple`, which is the default anyway', () => {
    const { manifest, warnings } = parseBlocksManifest(withLevel('simple'))
    expect(warnings).toEqual([])
    expect(manifest.blocks[0].level).toBeUndefined()
  })

  it('leaves a block that says nothing at the default', () => {
    const { manifest } = parseBlocksManifest(ONE_BLOCK)
    expect(manifest.blocks[0].level).toBeUndefined()
  })

  it('warns on a typo rather than hiding the block from everyone', () => {
    // `level: advnced` must not read as "advanced" — nor as a level at all.
    const { manifest, warnings } = parseBlocksManifest(withLevel('advnced'))
    expect(warnings).toEqual(['block "read": level must be one of simple, advanced — ignored'])
    expect(manifest.blocks[0].level).toBeUndefined()
  })

  it('holds a plugin to the same rule', () => {
    const { manifest, warnings } = normaliseBlocksManifest({
      version: 1,
      blocks: [{ id: 'raw', message: 'raw', code: 'raw()\n', level: 'advanced' }]
    })
    expect(warnings).toEqual([])
    expect(manifest.blocks[0].level).toBe('advanced')
  })
})

describe('round trip (epic #856)', () => {
  it('writes a manifest that parses back to itself', () => {
    const source = `
version: 1
blocks:
  - id: object
    message: the sensor (class %1)
    shape: value
    output: Object
    code: "{SETUP}"
    args:
      - name: CLASS
        kind: text-field
        default: VL53L0X
    setup:
      key: "part:tof"
      name: tof
      expr: "vl53l0x.{CLASS}(I2C(0, sda=Pin(4), scl=Pin(5)))"
    imports:
      - module: vl53l0x
      - module: machine
        name: I2C
    tooltip: The sensor itself.
    help: ref-pins
    scope: micropython
    level: advanced
    colour: '#d4553f'
    inline: false
  - id: read
    message: distance from %1
    shape: value
    output: Number
    code: "{OBJ}.read()"
    args:
      - name: OBJ
        kind: any
        shadow: object
`
    const first = parseBlocksManifest(source)
    expect(first.warnings).toEqual([])
    const second = parseBlocksManifest(blocksManifestToYaml(first.manifest))
    expect(second.warnings).toEqual([])
    expect(second.manifest).toEqual(first.manifest)
  })
})

describe('normaliseBlocksManifest', () => {
  it('holds a plugin to exactly the same rules as a part', () => {
    // The plugin path arrives as JSON over the RPC host rather than as YAML
    // text, and a plugin is not a more trusted author than a part.
    const { manifest, warnings } = normaliseBlocksManifest({
      blocks: [
        { id: 'ok', message: 'beep', code: 'buzzer.beep()\n' },
        { id: 'bad', message: 'boom', code: 'go({MISSING})' }
      ]
    })
    expect(manifest.blocks.map((b) => b.id)).toEqual(['ok'])
    expect(warnings.join('\n')).toContain('{MISSING}')
  })
})
