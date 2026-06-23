import { describe, expect, it } from 'vitest'
import { MODULES, moduleById, type ModuleDef } from '../src/shared/modules-catalog'
import {
  buildRowStatuses,
  countStatuses,
  rowAction,
  rowStatus,
  type ModuleInstallUiState
} from '../src/renderer/src/lib/modulesManager'

/**
 * Unit tests for the Modules-manager pure UI-state logic (#120): how the device
 * probe status combines with an in-flight install transition into the single
 * per-row status, the installed/available counts, and the per-status action.
 */

const done: ModuleInstallUiState = { status: 'done', log: '', notes: [] }
const installing: ModuleInstallUiState = { status: 'installing', log: '', notes: [] }
const errored: ModuleInstallUiState = { status: 'error', log: 'boom', notes: [] }

describe('rowStatus', () => {
  it('installing wins over everything', () => {
    expect(rowStatus('installed', installing)).toBe('installing')
    expect(rowStatus('available', installing)).toBe('installing')
  })

  it('probe-installed reads as installed', () => {
    expect(rowStatus('installed', undefined)).toBe('installed')
  })

  it('a just-completed install reads as installed before the next probe', () => {
    expect(rowStatus('available', done)).toBe('installed')
  })

  it('a failed install reads as error when the probe is not installed', () => {
    expect(rowStatus('available', errored)).toBe('error')
  })

  it('falls through to the probe status otherwise', () => {
    expect(rowStatus('available', undefined)).toBe('available')
    expect(rowStatus('unknown', undefined)).toBe('unknown')
  })
})

describe('buildRowStatuses', () => {
  it('marks everything unknown when disconnected', () => {
    const out = buildRowStatuses(MODULES, new Set(), false, {})
    expect(Object.values(out).every((s) => s === 'unknown')).toBe(true)
  })

  it('reflects the probe set + in-flight installs together', () => {
    const out = buildRowStatuses(
      MODULES,
      new Set(['ssd1306']),
      true,
      { hcsr04: installing, mpu6050: errored }
    )
    expect(out['ssd1306']).toBe('installed')
    expect(out['hcsr04']).toBe('installing')
    expect(out['mpu6050']).toBe('error')
    expect(out['sh1106']).toBe('available')
  })
})

describe('countStatuses', () => {
  it('counts installed vs available across the catalog', () => {
    const statuses = buildRowStatuses(MODULES, new Set(['ssd1306', 'hcsr04']), true, {})
    const counts = countStatuses(MODULES, statuses)
    expect(counts.total).toBe(MODULES.length)
    expect(counts.installed).toBe(2)
    expect(counts.available).toBe(MODULES.length - 2)
  })

  it('treats installing/error/unknown as not-yet-installed (available)', () => {
    const statuses = buildRowStatuses(MODULES, new Set(), true, {
      [MODULES[0].id]: installing
    })
    const counts = countStatuses(MODULES, statuses)
    expect(counts.installed).toBe(0)
    expect(counts.available).toBe(MODULES.length)
  })
})

describe('rowAction', () => {
  it('installed is a non-actionable stamp', () => {
    expect(rowAction('installed')).toEqual({ label: 'INSTALLED', actionable: false })
  })

  it('installing is disabled', () => {
    expect(rowAction('installing')).toEqual({ label: 'INSTALLING…', actionable: false })
  })

  it('error retries', () => {
    expect(rowAction('error')).toEqual({ label: 'RETRY', actionable: true })
  })

  it('available / unknown offer an install', () => {
    expect(rowAction('available').label).toBe('INSTALL')
    expect(rowAction('unknown').label).toBe('INSTALL')
    expect(rowAction('available').actionable).toBe(true)
  })
})

describe('catalog wiring sanity', () => {
  it('every bundled def has a resolvable install path basename', () => {
    const bundled: ModuleDef[] = MODULES.filter((m) => m.source.kind === 'bundled')
    expect(bundled.length).toBeGreaterThan(0)
    for (const m of bundled) {
      const def = moduleById(m.id)!
      expect(def.source.kind).toBe('bundled')
    }
  })
})
