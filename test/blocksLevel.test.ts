import { describe, it, expect, beforeAll } from 'vitest'
import { installCorePalette } from '../src/renderer/src/lib/blocks/palette'
import {
  atLevel,
  blocksInCategory,
  installBlockDefinitions,
  leveled,
  registeredBlocks,
  type BlockDefinition
} from '../src/renderer/src/lib/blocks/registry'
import {
  ADVANCED_OFF_HINT,
  buildToolbox,
  categoryContents
} from '../src/renderer/src/lib/blocks/toolbox'
import { BLOCK_CATEGORIES } from '../src/renderer/src/lib/blocks/theme'
import { defaultBlockLevel } from '../src/renderer/src/store/settings'
import type { BlockLevel } from '../src/renderer/src/lib/blocks/registry'

/**
 * SIMPLE AND ADVANCED BLOCKS (#1209 / #1210, epic #1206).
 * =============================================================================
 *
 * A third filter on the toolbox, beside `hidden` and `scope`, with the same
 * rule as the other two: it decides what a learner can REACH FOR, never what
 * is registered. The first test pins the advanced set as a list, so adding a
 * block to it — or forgetting to — is a diff someone has to read.
 */

beforeAll(() => {
  installCorePalette()
  installBlockDefinitions()
})

/** Every block type a toolbox offers, flattened out of the tree. */
function flatten(toolbox: unknown): string[] {
  const out: string[] = []
  const walk = (items: readonly unknown[]): void => {
    for (const item of items as Record<string, unknown>[]) {
      if (item.kind === 'block' && typeof item.type === 'string') out.push(item.type)
      if (Array.isArray(item.contents)) walk(item.contents)
    }
  }
  walk((toolbox as { contents: unknown[] }).contents)
  return out
}

/** Every block type the toolbox offers at `level`. */
const offered = (level: BlockLevel): string[] => flatten(buildToolbox('micropython', level))

describe('which blocks are advanced (#1209)', () => {
  it('is exactly this list — change it here when the curriculum decision changes', () => {
    const advanced = registeredBlocks()
      .filter((b) => b.level === 'advanced')
      .map((b) => b.type)
      .sort()
    expect(advanced).toEqual(
      [
        // Structure: class, method, self, try, with, await, raise.
        'snakie_class',
        'snakie_method',
        'snakie_self',
        // …and the block that makes one of a class (B5, #1224).
        'snakie_new_instance',
        'snakie_try',
        'snakie_with',
        'snakie_await',
        'snakie_await_value',
        'snakie_raise',
        // Files, and the `use … as` that closes them.
        'snakie_use',
        'snakie_file_open',
        'snakie_file_write',
        'snakie_file_lines',
        // Comprehensions.
        'snakie_list_comprehension',
        'snakie_dict_comprehension',
        // Slices.
        'snakie_slice_range',
        'snakie_slice_first',
        'snakie_slice_last',
        'snakie_last_item',
        'snakie_slice_copy',
        'snakie_slice_reverse',
        // Buffers.
        'snakie_buffer_new',
        'snakie_bytes_of',
        'snakie_bytes_encode',
        'snakie_bytes_decode',
        // Bitwise and base-N maths.
        'snakie_bitwise',
        'snakie_bitwise_not',
        'snakie_bit_shift',
        'snakie_hex_number',
        'snakie_binary_number',
        'snakie_bit_of',
        'snakie_int_base',
        // Variables: global, del, and the scope escape hatches.
        'snakie_global',
        'snakie_forget',
        'snakie_python_assign',
        'snakie_python_augmented',
        'snakie_python_scope',
        // Functions: super().
        'snakie_super',
        // The grey escape hatches, whole.
        ...blocksInCategory('python').map((b) => b.type),
        'snakie_spread',
        'snakie_spread_named'
      ]
        .filter((t, i, all) => all.indexOf(t) === i)
        .sort()
    )
  })

  it('defaults to simple, so a block that says nothing lands in the beginner drawer', () => {
    const untagged = registeredBlocks().filter((b) => b.level === undefined)
    expect(untagged.length).toBeGreaterThan(0)
    for (const b of untagged) expect(atLevel(b, 'simple')).toBe(true)
  })

  it('leveled() marks a palette without overriding a block that states its own', () => {
    const defs = [
      { type: 'a', category: 'python', code: () => '' },
      { type: 'b', category: 'python', code: () => '', level: 'simple' }
    ] as BlockDefinition[]
    expect(leveled('advanced', defs).map((d) => d.level)).toEqual(['advanced', 'simple'])
  })
})

describe('the toolbox filters on level (#1210)', () => {
  it('offers no advanced block in simple mode, and every one of them in advanced mode', () => {
    const simple = new Set(offered('simple'))
    const advanced = new Set(offered('advanced'))
    for (const def of registeredBlocks()) {
      if (def.hidden || def.level !== 'advanced') continue
      expect(simple.has(def.type), `${def.type} offered in simple mode`).toBe(false)
    }
    // Advanced is the whole palette — the same set the toolbox offered before
    // the level existed, which is what `buildToolbox(dialect)` still means.
    expect([...advanced].sort()).toEqual(flatten(buildToolbox('micropython')).sort())
    expect(simple.size).toBeLessThan(advanced.size)
  })

  it('keeps the simple blocks — a drawer with both kinds keeps its beginner half', () => {
    const simple = new Set(offered('simple'))
    expect(simple.has('math_arithmetic')).toBe(true)
    expect(simple.has('snakie_bitwise')).toBe(false)
    expect(simple.has('lists_create_with')).toBe(true)
    expect(simple.has('snakie_list_comprehension')).toBe(false)
  })

  it('drops a sub-category the level emptied rather than showing it blank', () => {
    const control = BLOCK_CATEGORIES.find((c) => c.id === 'control')!
    const names = (items: Record<string, unknown>[]): string[] =>
      items.filter((i) => i.kind === 'category').map((i) => i.name as string)
    const withFiles = names(categoryContents(control, 'micropython', 'advanced'))
    const without = names(categoryContents(control, 'micropython', 'simple'))
    // The Files shelf is advanced as a whole; in simple mode it is not there.
    expect(withFiles.length).toBeGreaterThan(without.length)
    for (const name of without) expect(withFiles).toContain(name)
  })

  it('says why an all-advanced drawer is empty, instead of the fill-me hint', () => {
    const python = BLOCK_CATEGORIES.find((c) => c.id === 'python')!
    expect(categoryContents(python, 'micropython', 'simple')).toEqual([
      { kind: 'label', text: ADVANCED_OFF_HINT }
    ])
    expect(categoryContents(python, 'micropython', 'advanced').length).toBeGreaterThan(1)
  })

  it('never touches the registry — every advanced block stays registered', () => {
    // The reason is the same as for `scope`: `workspace-check.ts` refuses a
    // file holding a type this build does not know, so a filter that
    // deregistered would make every advanced program unopenable.
    for (const type of ['snakie_class', 'snakie_try', 'snakie_list_comprehension'])
      expect(registeredBlocks().some((b) => b.type === type)).toBe(true)
  })
})

describe('the default level (#1210)', () => {
  const storage = (keys: string[]): Pick<Storage, 'length' | 'key'> => ({
    length: keys.length,
    key: (i: number) => keys[i] ?? null
  })

  it('is simple for a fresh profile', () => {
    expect(defaultBlockLevel(storage([]))).toBe('simple')
    expect(defaultBlockLevel(storage(['someone-elses.key']))).toBe('simple')
  })

  it('is advanced for a profile that used Snakie before the setting existed', () => {
    expect(defaultBlockLevel(storage(['snakie.blocks.shape']))).toBe('advanced')
    expect(defaultBlockLevel(storage(['other', 'snakie.editor.paper']))).toBe('advanced')
  })

  it('treats storage that throws as fresh', () => {
    const broken = {
      length: 1,
      key: () => {
        throw new Error('no storage')
      }
    }
    expect(defaultBlockLevel(broken)).toBe('simple')
  })
})
