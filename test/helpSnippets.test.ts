import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

/**
 * A help page's code must RUN if you copy it.
 *
 * Five Modulino pages had a snippet that used its device object without ever
 * creating one — the LED Matrix's "you must call show()" example opened with
 * `matrix.set_pixel(3, 4)`, so copying it gave `matrix isn't defined`. The
 * example that teaches the single biggest gotcha was itself broken.
 *
 * A snippet is allowed to omit setup only if it doesn't use a device at all.
 */
const LIB = join(__dirname, '..', 'examples', 'parts', 'snakie-standard')
const HELPS = readdirSync(LIB, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => join(LIB, e.name, 'help.md'))
  .filter((p) => {
    try {
      readFileSync(p)
      return true
    } catch {
      return false
    }
  })

/** Names a help page uses for its device instance. */
const DEVICES = [
  'matrix', 'buzzer', 'buttons', 'distance', 'light', 'motors', 'movement',
  'knob', 'pixels', 'thermo', 'joystick', 'vibro', 'relay', 'display', 'sensor'
]

describe('help.md python snippets are self-contained', () => {
  it('there are help pages to check', () => {
    expect(HELPS.length).toBeGreaterThan(0)
  })

  it.each(HELPS)('%s', (path) => {
    const src = readFileSync(path, 'utf-8')
    for (const [, body] of src.matchAll(/```python\n([\s\S]*?)```/g)) {
      for (const name of DEVICES) {
        const uses = new RegExp(`^\\s*${name}\\.`, 'm').test(body)
        if (!uses) continue
        const made = new RegExp(`${name}\\s*=`).test(body) || /\bimport\b/.test(body)
        expect(made, `uses \`${name}.\` without creating it:\n${body.trim().slice(0, 120)}`).toBe(true)
      }
    }
  })
})
