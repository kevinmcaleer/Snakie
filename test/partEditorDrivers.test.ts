import { describe, expect, it } from 'vitest'
import {
  blankPart,
  driverRowWarnings,
  driverTargetSpec,
  moduleDriverRow,
  moveDriver,
  normalisePart,
  placedPartsNeedingDrivers,
  removeDriver,
  updateDriver,
  type DriverFile
} from '../src/renderer/src/components/part-editor.util'

/**
 * Unit tests for the Part Editor's Drivers section logic (#655): the
 * method-aware target field, the catalog-derived module rows, the immutable
 * list ops, the author-time warnings, and the save/consume round trip that
 * makes an authored part actually fire the Driver Install banner (#184).
 */

const copy = (over: Partial<DriverFile> = {}): DriverFile => ({
  source: 'servo.py',
  target: 'lib/servo.py',
  ...over
})

describe('driverTargetSpec', () => {
  it('labels the target per install method — folder vs path vs derived', () => {
    expect(driverTargetSpec('mip').label).toBe('Install folder')
    expect(driverTargetSpec('copy').label).toBe('Path on device')
    expect(driverTargetSpec('module').editable).toBe(false)
    expect(driverTargetSpec('mip').editable).toBe(true)
    expect(driverTargetSpec('copy').editable).toBe(true)
  })
})

describe('moduleDriverRow', () => {
  it('builds a catalog row with the house lib/<file> target (bundled module)', () => {
    expect(moduleDriverRow('lsm6ds3')).toEqual({
      source: 'module:lsm6ds3',
      target: 'lib/lsm6ds3.py',
      label: 'LSM6DS3 IMU driver'
    })
  })

  it('derives a lib/<importName>.py target for a mip-backed catalog module', () => {
    // Matches the hand-authored grove-led-bar part: module:my9221 → lib/my9221.py.
    expect(moduleDriverRow('my9221')?.target).toBe('lib/my9221.py')
  })

  it('refuses an unknown id — a bad id cannot be authored', () => {
    expect(moduleDriverRow('not-a-module')).toBeNull()
    expect(moduleDriverRow('')).toBeNull()
  })
})

describe('driver list ops', () => {
  const list = [copy({ source: 'a.py' }), copy({ source: 'b.py' }), copy({ source: 'c.py' })]

  it('updateDriver patches one row immutably', () => {
    const next = updateDriver(list, 1, { label: 'B' })
    expect(next[1].label).toBe('B')
    expect(next).not.toBe(list)
    expect(list[1].label).toBeUndefined()
  })

  it('removeDriver drops one row', () => {
    expect(removeDriver(list, 1).map((d) => d.source)).toEqual(['a.py', 'c.py'])
  })

  it('moveDriver swaps neighbours and no-ops at the edges', () => {
    expect(moveDriver(list, 2, -1).map((d) => d.source)).toEqual(['a.py', 'c.py', 'b.py'])
    expect(moveDriver(list, 0, -1)).toBe(list)
    expect(moveDriver(list, 2, 1)).toBe(list)
  })
})

describe('driverRowWarnings', () => {
  it('an empty source states the real consequence — dropped on save', () => {
    expect(driverRowWarnings(copy({ source: '' }), null)[0]).toMatch(/dropped on save/)
  })

  it('an empty target states the same (normalisePart drops the row)', () => {
    expect(driverRowWarnings(copy({ target: '' }), null)[0]).toMatch(/dropped on save/)
    expect(driverRowWarnings({ source: 'micropython-servo', target: '' }, null)[0]).toMatch(
      /dropped on save/
    )
  })

  it('flags a module id the catalog does not know', () => {
    expect(driverRowWarnings({ source: 'module:nope', target: 'lib/x.py' }, null)[0]).toMatch(
      /not in the modules catalog/
    )
    expect(driverRowWarnings({ source: 'module:lsm6ds3', target: 'lib/lsm6ds3.py' }, null)).toEqual([])
  })

  it('flags a mip target that is really a file path — the wrong-place trap', () => {
    expect(
      driverRowWarnings({ source: 'github:me/repo/x.py', target: 'lib/x.py' }, null)[0]
    ).toMatch(/FOLDER/)
    expect(driverRowWarnings({ source: 'github:me/repo/x.py', target: 'lib' }, null)).toEqual([])
  })

  it('flags a copy target that is not a full file path', () => {
    expect(driverRowWarnings(copy({ target: 'lib' }), null)[0]).toMatch(/full destination/)
  })

  it('flags a bundled filename that does not ship with the part', () => {
    expect(driverRowWarnings(copy(), ['other.py'])[0]).toMatch(/does not ship/)
    expect(driverRowWarnings(copy(), ['servo.py', 'other.py'])).toEqual([])
  })

  it('never warns about missing files from ignorance (null list) or for URLs', () => {
    expect(driverRowWarnings(copy(), null)).toEqual([])
    expect(
      driverRowWarnings({ source: 'https://example.com/x.py', target: 'lib/x.py' }, ['a.py'])
    ).toEqual([])
  })
})

describe('save → consume round trip (#655 acceptance)', () => {
  it('normalisePart keeps an authored driver list — order and labels intact', () => {
    const part = {
      ...blankPart(),
      drivers: [
        { source: 'module:lsm6ds3', target: 'lib/lsm6ds3.py', label: 'IMU driver' },
        copy({ source: 'extra.py', target: 'lib/extra.py' })
      ]
    }
    expect(normalisePart(part).drivers).toEqual(part.drivers)
  })

  it('normalisePart drops rows without a source or target (what the UI warns about)', () => {
    const part = { ...blankPart(), drivers: [copy(), copy({ target: '' }), copy({ source: '' })] }
    expect(normalisePart(part).drivers).toEqual([copy()])
  })

  it('a part authored this way fires the Driver Install need on placement', () => {
    const part = { ...blankPart(), id: 'my-sensor', drivers: [copy()] }
    const needs = placedPartsNeedingDrivers(
      { parts: [{ id: 'p1', lib: 'my-parts', part: 'my-sensor', x: 0, y: 0 }] },
      [{ id: 'my-parts', parts: [part] }]
    )
    expect(needs).toHaveLength(1)
    expect(needs[0].drivers).toEqual([copy()])
  })
})
