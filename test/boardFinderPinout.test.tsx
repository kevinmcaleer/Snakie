import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { partFromYaml } from '../src/shared/part-yaml'
import { pinoutReading } from '../src/renderer/src/components/part-details'
import { PartPreview } from '../src/renderer/src/components/PartPreview'
import type { PartPin } from '../src/shared/part'

/**
 * Reading a board's pads in the Board Finder (#934).
 *
 * The finder could tell you which `.uf2` to write and nothing about where GP4
 * is; the parts library knew every pad and was never shown beside the board it
 * belongs to. This covers the half that answers the question: the readout that
 * names one pad, and the stage that carries it into a page that had no pins at
 * all. The join itself is `boardPartLink.test.ts`.
 */

const html = (node: Parameters<typeof renderToStaticMarkup>[0]): string =>
  renderToStaticMarkup(node)

const pico = partFromYaml(readFileSync('examples/parts/snakie-standard/pico/parts.yml', 'utf-8'))

const pin = (over: Partial<PartPin> = {}): PartPin =>
  ({ name: 'GP0', type: 'io', ...over }) as PartPin

describe('what a pad says when you hover it', () => {
  it('names the bus, not just the protocol', () => {
    // "I2C SDA" is the answer that sends you counting across the board; which
    // I2C is what decides whether two devices can share it.
    const r = pinoutReading(
      pin({ name: 'GP4', gpio: 4, capabilities: ['i2c'], signals: { i2c: 'SDA' }, buses: { i2c: 0 } })
    )
    expect(r.functions).toContain('I2C0 SDA')
    expect(r.functions).not.toContain('I2C SDA')
  })

  it('carries the pin number when the board prints one', () => {
    expect(pinoutReading(pin({ number: 6 })).number).toBe('Pin 6')
    expect(pinoutReading(pin()).number).toBeNull()
  })

  it('says the electrical role in words', () => {
    expect(pinoutReading(pin({ type: 'gnd', name: 'GND' })).role).toBe('Ground')
    expect(pinoutReading(pin({ type: 'pwr', name: 'VBUS' })).role).toBe('Power')
    expect(pinoutReading(pin({ type: 'io' })).role).toBe('I/O')
  })

  it('claims no capabilities for a power or ground pad', () => {
    // A GND pad with a stray `capabilities` list would otherwise advertise a bus
    // on a pin that is not an I/O at all.
    const r = pinoutReading(pin({ type: 'gnd', name: 'GND', capabilities: ['i2c'] }))
    expect(r.functions).toEqual([])
  })

  it('prefers the printed silk over the internal name', () => {
    expect(pinoutReading(pin({ name: 'GP4', label: 'SDA' })).name).toBe('SDA')
    expect(pinoutReading(pin({ name: 'GP4' })).name).toBe('GP4')
  })

  it('names the PWM slice on the chips that HAVE slices', () => {
    // Two RP2040 pads on the same slice cannot run different duty cycles;
    // `PWM 2A` says which slice, `PWM A` alone does not.
    const p = pin({ gpio: 4, capabilities: ['pwm'], signals: { pwm: 'A' } })
    expect(pinoutReading(p, 'RP2040').functions).toEqual(['PWM 2A'])
    expect(pinoutReading(p, 'RP2350').functions).toEqual(['PWM 2A'])
  })

  it('invents no slice for a chip that has none', () => {
    // An ESP32 routes PWM through a matrix and an nRF52 through four instances.
    // A slice number on either would be one this code made up — and three of the
    // linked boards are exactly those chips.
    const p = pin({ gpio: 4, capabilities: ['pwm'], signals: { pwm: 'A' } })
    expect(pinoutReading(p, 'ESP32').functions).toEqual(['PWM A'])
    expect(pinoutReading(p, 'nRF52840').functions).toEqual(['PWM A'])
    // A part that states no chip gets no derivation either.
    expect(pinoutReading(p).functions).toEqual(['PWM A'])
  })

  it('still says which half of a slice, with no GPIO to work from', () => {
    expect(pinoutReading(pin({ capabilities: ['pwm'], signals: { pwm: 'B' } }), 'RP2040').functions)
      .toEqual(['PWM B'])
  })

  it('numbers the ADC channel where the part gives one', () => {
    expect(pinoutReading(pin({ capabilities: ['adc'], buses: { adc: 2 } })).functions)
      .toEqual(['ADC2'])
    expect(pinoutReading(pin({ capabilities: ['adc'] })).functions).toEqual(['ADC'])
  })

  it('reads a real Pico pad end to end', () => {
    const pins = (pico.headers ?? []).flatMap((h) => h.pins ?? [])
    const gp4 = pins.find((p) => p.name === 'GP4')!
    const r = pinoutReading(gp4, pico.mcu)
    expect(r.name).toBe('GP4')
    expect(r.number).toBe('Pin 6')
    expect(r.role).toBe('I/O')
    expect(r.functions).toContain('I2C0 SDA')
  })
})

describe('the stage, with the readout switched on', () => {
  const withPinout = html(<PartPreview part={pico} libraryId="snakie-standard" pinout />)
  const without = html(<PartPreview part={pico} libraryId="snakie-standard" />)

  it('offers every pad to a keyboard, not only to a pointer', () => {
    // A hover-only readout is one a keyboard or screen-reader user never gets.
    expect(withPinout).toContain('Choose a pin…')
    expect(withPinout).toContain('>6 · GP4<')
    expect(withPinout).toContain('>3 · GND<')
  })

  it('keeps the readout line before anything is hovered', () => {
    // Reserved, not conjured: a strip that appears on hover shifts the board out
    // from under the pointer that summoned it.
    expect(withPinout).toContain('ppv__pin-read')
    expect(withPinout).toContain('Hover a pad to read it')
  })

  it('announces the reading to a screen reader as it changes', () => {
    expect(withPinout).toContain('aria-live="polite"')
  })

  it('adds nothing at all when the host did not ask for it', () => {
    expect(without).not.toContain('ppv__pinout')
    expect(without).not.toContain('Choose a pin…')
  })

  it('still stages the board itself either way', () => {
    for (const out of [withPinout, without]) {
      expect(out).toContain('>Board<')
      expect(out).toContain('>Schematic<')
    }
  })
})

describe('the preview is one component, not two lookalikes', () => {
  const finder = readFileSync('src/renderer/src/components/BoardFinder.tsx', 'utf8')
  const details = readFileSync('src/renderer/src/components/PartDetailsView.tsx', 'utf8')
  const preview = readFileSync('src/renderer/src/components/PartPreview.tsx', 'utf8')

  it('is used by both readers', () => {
    expect(finder).toContain('<PartPreview')
    expect(details).toContain('<PartPreview')
  })

  it('leaves neither host with its own copy of the stage', () => {
    // The board view already exists twice in this app and diverged; the stage
    // must not repeat it. Only PartPreview mounts the canvas and the model.
    for (const host of [finder, details]) {
      expect(host).not.toContain('<PartCanvas')
      expect(host).not.toContain('<PartMeshView')
    }
    expect(preview).toContain('<PartCanvas')
    expect(preview).toContain('PartMeshView')
  })
})

describe('the finder only shows hardware it actually has', () => {
  const finder = readFileSync('src/renderer/src/components/BoardFinder.tsx', 'utf8')

  it('renders the section only when a part resolved', () => {
    expect(finder).toContain('{hardware && (')
  })

  it('reads the parts libraries only for a board that has a link', () => {
    // 11 boards of 225 are linked; the other 214 must not pay for a library read
    // whose answer is thrown away. (What the read then RESOLVES to is
    // `findLinkedPart`, covered in boardPartLink.test.ts.)
    expect(finder).toContain('if (!link) return')
  })
})
