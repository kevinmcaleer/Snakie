import { describe, it, expect } from 'vitest'
import {
  libEntryToPackage,
  buildVersionProbe,
  parseVersionProbe,
  missingProjectImports
} from '../src/renderer/src/lib/board-packages'

/** On-board package helpers (#131). */
describe('board-packages', () => {
  it('maps /lib entries to packages, skipping noise', () => {
    expect(libEntryToPackage({ name: 'servo.py', isDir: false })).toEqual({
      name: 'servo', path: '/lib/servo.py', isDir: false
    })
    expect(libEntryToPackage({ name: 'ssd1306.mpy', isDir: false })?.name).toBe('ssd1306')
    expect(libEntryToPackage({ name: 'umqtt', isDir: true })?.path).toBe('/lib/umqtt')
    expect(libEntryToPackage({ name: '__pycache__', isDir: true })).toBeNull()
    expect(libEntryToPackage({ name: 'README.txt', isDir: false })).toBeNull()
  })

  it('version probe reads files (never imports) and round-trips JSON', () => {
    const probe = buildVersionProbe([
      { name: 'servo', path: '/lib/servo.py', isDir: false },
      { name: 'umqtt', path: '/lib/umqtt', isDir: true }
    ])
    expect(probe).toContain('"/lib/servo.py"')
    expect(probe).toContain('"/lib/umqtt/__init__.py"')
    expect(probe).not.toContain('__import__')
    expect(probe).not.toMatch(/\bimport (?!json)/)
    expect(parseVersionProbe('>>> {"servo": "1.2.0"}\n')).toEqual({ servo: '1.2.0' })
    expect(parseVersionProbe('garbage')).toEqual({})
  })

  it('missing imports exclude builtins, on-board and project modules', () => {
    const missing = missingProjectImports(
      ['machine', 'time', 'servo', 'mqtt.simple', 'ssd1306', 'mycode'],
      ['servo'],
      ['mycode']
    )
    expect(missing).toEqual(['mqtt', 'ssd1306'])
  })
})
