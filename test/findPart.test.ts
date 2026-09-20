import { describe, expect, it } from 'vitest'
import {
  findPart,
  RETIRED_PART_IDS,
  type PartDefinition,
  type PartLibraryWithParts
} from '../src/shared/part'

/**
 * A placed part is named by the library it was placed FROM, and that name does
 * not follow the part: promote it into the Standard library, or open the
 * project in the web build (which ships only the Standard library), and
 * `robot.yml` still says `my-parts`. The wiring canvas drew every such part as
 * a `part library not installed` box while the bill of materials on the very
 * next page named it — one document, two opinions about the same part.
 */
const part = (id: string, name: string): PartDefinition =>
  ({ id, name, headers: [] }) as unknown as PartDefinition

const lib = (id: string, ...parts: PartDefinition[]): PartLibraryWithParts =>
  ({ id, name: id, parts }) as unknown as PartLibraryWithParts

describe('findPart', () => {
  const standard = lib('snakie-standard', part('sg90', 'SG90 (standard)'), part('hc-sr04', 'HC-SR04'))
  const mine = lib('my-parts', part('sg90', 'SG90 (mine)'))

  it('prefers the part from the library the project named', () => {
    expect(findPart([standard, mine], 'my-parts', 'sg90')?.name).toBe('SG90 (mine)')
    expect(findPart([standard, mine], 'snakie-standard', 'sg90')?.name).toBe('SG90 (standard)')
  })

  it('falls back to the same id in any installed library when that library is absent', () => {
    expect(findPart([standard], 'my-parts', 'sg90')?.name).toBe('SG90 (standard)')
    expect(findPart([standard], 'renamed-library', 'hc-sr04')?.name).toBe('HC-SR04')
  })

  it('resolves a withdrawn part to the one that replaced it (#638)', () => {
    // hr-sr04 was a typo'd duplicate of the HC-SR04. Projects that placed it
    // still say `hr-sr04`, and no library defines that id any more — so without
    // this the sensor drew as an uninstalled box and prompted for no driver.
    expect(RETIRED_PART_IDS['hr-sr04']).toBe('hc-sr04')
    expect(findPart([standard], 'snakie-standard', 'hr-sr04')?.name).toBe('HC-SR04')
  })

  it('prefers a library that really has the retired id over its replacement', () => {
    const legacy = lib('legacy', part('hr-sr04', 'HR SR04 (still installed)'))
    expect(findPart([standard, legacy], 'snakie-standard', 'hr-sr04')?.name).toBe(
      'HR SR04 (still installed)'
    )
  })

  it('is null when no library has the part, and with no libraries at all', () => {
    expect(findPart([standard, mine], 'my-parts', 'nope')).toBeNull()
    expect(findPart([], 'snakie-standard', 'sg90')).toBeNull()
    expect(findPart(undefined, 'snakie-standard', 'sg90')).toBeNull()
  })
})
