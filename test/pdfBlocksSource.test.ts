// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * Where the export's blocks come from (#1112 follow-up): the canvas on screen
 * when there is one, the file's own blocks — built off-screen — when there is
 * not. Printing from the Code, Electronics or Build workspace, or with the
 * split collapsed to its Python, used to drop the blocks without a word.
 */

const SRC = (p: string): string => readFileSync(join(__dirname, '..', 'src', p), 'utf-8')

vi.mock('../src/renderer/src/lib/blocks/python-editor', () => ({}))

describe('hasBlocks', () => {
  it('is any .py with stored content — what the Blocks view would open on', async () => {
    const { hasBlocks } = await import('../src/renderer/src/lib/pdf/blocks-source')
    expect(hasBlocks({ entryFile: 'main.py', stored: 'print(1)\n' })).toBe(true)
    expect(hasBlocks({ entryFile: 'MAIN.PY', stored: '' })).toBe(true)
    expect(hasBlocks({ entryFile: 'robot.yml', stored: 'name: x' })).toBe(false)
    expect(hasBlocks({ entryFile: 'main.py', stored: null })).toBe(false)
    expect(hasBlocks({ stored: 'print(1)' })).toBe(false)
  })
})

describe('resolveBlocksSource', () => {
  afterEach(async () => {
    const { resetBlocksWorkspaceRegistry } =
      await import('../src/renderer/src/lib/blocks/workspace-registry')
    resetBlocksWorkspaceRegistry()
    vi.resetModules()
  })

  it('prefers the canvas on screen, and never disposes it', async () => {
    const registry = await import('../src/renderer/src/lib/blocks/workspace-registry')
    const { resolveBlocksSource } = await import('../src/renderer/src/lib/pdf/blocks-source')
    const live = { dispose: vi.fn() }
    registry.registerBlocksWorkspace(live as never)
    const source = resolveBlocksSource({ entryFile: 'main.py', stored: 'x = 1\n' })
    expect(source?.live).toBe(true)
    expect(source?.workspace).toBe(live)
    source?.dispose()
    expect(live.dispose).not.toHaveBeenCalled()
  })

  it('has nothing to print for a file that is not a program', async () => {
    const { resolveBlocksSource } = await import('../src/renderer/src/lib/pdf/blocks-source')
    expect(resolveBlocksSource({ entryFile: 'robot.yml', stored: 'name: x' })).toBeNull()
    expect(resolveBlocksSource({ entryFile: 'main.py', stored: null })).toBeNull()
  })

  it('refuses, out loud, a file whose blocks this build cannot read', async () => {
    const { resolveBlocksSource } = await import('../src/renderer/src/lib/pdf/blocks-source')
    const { writeBlocksFooter } = await import('../src/shared/blocks-doc')
    const stored = writeBlocksFooter('x = 1\n', {
      blocks: { blocks: [{ type: 'from_the_future', id: 'a' }] }
    })
    // A type no palette registers: the off-screen path must throw rather than
    // hand back an empty workspace and call the section complete.
    expect(() => resolveBlocksSource({ entryFile: 'main.py', stored })).toThrow(/from_the_future/)
  })
})

describe('the export action', () => {
  const EXPORT = SRC('renderer/src/lib/pdf/export-project.ts')

  it('asks the blocks source, not the registry, for its workspace', () => {
    expect(EXPORT).toContain("import('./blocks-source')")
    expect(EXPORT).not.toContain('getBlocksWorkspace')
  })

  it('takes the off-screen workspace down whatever happens', () => {
    expect(EXPORT).toMatch(/finally \{[\s\S]*source\?\.dispose\(\)/)
  })

  it('reports a source that could not be built as an omission', () => {
    expect(EXPORT).toContain('blockStacks: async () => {')
    expect(EXPORT).toContain('throw error')
  })
})
