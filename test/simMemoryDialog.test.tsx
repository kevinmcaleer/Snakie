import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { SimMemoryDialog } from '../src/renderer/src/components/SimMemoryDialog'
import { SIM_HEAP_DEFAULT_BYTES, SIM_HEAP_PRESETS } from '../src/shared/sim-memory'

/**
 * The simulated-device memory dialog rendered to static HTML (#901) — vitest
 * runs in node, and SSR markup is what the browser mounts.
 *
 * The assertions that matter are the honest ones: the dialog has to say that the
 * heap is a starting size rather than a cap, and that `gc.mem_free()` doesn't
 * report it. Someone tidying this copy up should have to update a test.
 */

const html = (node: Parameters<typeof renderToStaticMarkup>[0]): string =>
  renderToStaticMarkup(node)

const render = (over: Partial<Parameters<typeof SimMemoryDialog>[0]> = {}): string =>
  html(
    <SimMemoryDialog
      value={SIM_HEAP_DEFAULT_BYTES}
      booted={null}
      onSave={() => {}}
      onSaveAndRestart={() => {}}
      onClose={() => {}}
      {...over}
    />
  )

describe('SimMemoryDialog', () => {
  it('offers every preset, with the current one selected', () => {
    const out = render({ value: 192 * 1024 })
    for (const preset of SIM_HEAP_PRESETS) expect(out).toContain(preset.label)
    expect(out).toContain('simmem__preset--on')
  })

  it('says the heap is a starting size, not a limit', () => {
    const out = render()
    expect(out).toContain('starting heap, not a limit')
    expect(out).toContain('grows its heap on demand')
  })

  it('explains that gc.mem_free() does not report this number', () => {
    // Without this the setting looks broken the first time anyone checks it.
    const out = render()
    expect(out).toContain('gc.mem_free()')
    expect(out).toContain('128')
  })

  it('when the simulator is not running: saving is the whole action', () => {
    const out = render({ booted: null })
    expect(out).toContain('will start with this heap')
    expect(out).toContain('>Save<')
    expect(out).not.toContain('Save and restart simulator')
  })

  it('when the live heap already matches: no restart is offered', () => {
    const out = render({ value: 192 * 1024, booted: 192 * 1024 })
    expect(out).toContain('running with 192 KB')
    expect(out).not.toContain('Save and restart simulator')
  })

  it('when the live heap differs: offers a restart and warns it clears the files', () => {
    const out = render({ value: 32 * 1024, booted: 1024 * 1024 })
    expect(out).toContain('Save and restart simulator')
    expect(out).toContain('running with 1 MB')
    expect(out).toContain('clears its files')
  })

  it('is a labelled modal dialog', () => {
    const out = render()
    expect(out).toContain('role="dialog"')
    expect(out).toContain('aria-modal="true"')
    expect(out).toContain('aria-labelledby="simmem-title"')
  })
})
