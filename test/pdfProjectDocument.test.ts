import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  type DiagramArt,
  type ProjectArt,
  type StackArt,
  buildProjectPdf,
  fileStem
} from '../src/renderer/src/lib/pdf/project-pdf'
import { BOM_HEADING } from '../src/renderer/src/lib/pdf/sections/bom'
import {
  CONNECTIONS_HEADING,
  buildConnections
} from '../src/renderer/src/lib/pdf/sections/connections'
import {
  BLOCKS_INTRO,
  BOM_INTRO,
  CODE_INTRO,
  CODE_INTRO_WITH_BLOCKS,
  CONNECTIONS_INTRO
} from '../src/renderer/src/lib/pdf/sections/narrative'
import { blankRobot } from '../src/shared/robot'
import { robotFromYaml } from '../src/shared/robot-yaml'
import { COFFEE_URL, SNAKIE_WEB_URL } from '../src/shared/links'
import {
  latin1,
  pageImages,
  pageLinks,
  pageStrings,
  pages,
  parsePdf
} from './helpers/pdf-inspect'

/**
 * The assembled project document (#1108) — the issue that makes epic #1105
 * true.
 *
 * The art is injected, so these assert a real byte stream rather than "it
 * didn't throw".
 */

const DEMO = join(__dirname, '..', 'examples', 'servo-arm')
const demoRobot = (): ReturnType<typeof robotFromYaml> =>
  robotFromYaml(readFileSync(join(DEMO, 'robot.yml'), 'utf-8'))
const demoCode = (): string => readFileSync(join(DEMO, 'sweep.py'), 'utf-8')

function jpeg(n = 64): { jpeg: Uint8Array; width: number; height: number } {
  return { jpeg: new Uint8Array(n).fill(0x5a), width: 200, height: 150 }
}

function stack(id: string, label?: string): StackArt {
  return { id, label, width: 220, height: 160, jpeg: jpeg() }
}

const diagram: DiagramArt = { width: 700, height: 420, jpeg: jpeg(128) }

function art(over: Partial<ProjectArt> = {}): ProjectArt {
  return {
    blockStacks: async () => [],
    wiring: async () => null,
    logo: async () => null,
    ...over
  }
}

/** Every page's text, in document order. */
function textOfPages(bytes: Uint8Array): string[][] {
  const pdf = parsePdf(bytes)
  return pages(pdf).map((p) => pageStrings(pdf, p))
}

describe('the whole document', () => {
  it('lays the sections out in the order #1105 asks for', async () => {
    const result = await buildProjectPdf(
      {
        robot: demoRobot(),
        folder: DEMO,
        entryFile: 'sweep.py',
        code: { stored: demoCode() },
        date: new Date(2026, 8, 19)
      },
      {
        art: art({
          blockStacks: async () => [stack('f1', 'Function: sweep'), stack('main', 'Main program')],
          wiring: async () => diagram
        })
      }
    )
    const text = textOfPages(result.bytes)
    const flat = text.map((p) => p.join(' '))
    const indexOf = (needle: string): number => flat.findIndex((p) => p.includes(needle))
    // The cover also signs itself "Made with Snakie", so the closing page is
    // the LAST match, not the first.
    const lastIndexOf = (needle: string): number =>
      flat.length - 1 - [...flat].reverse().findIndex((p) => p.includes(needle))

    // The cover takes the name from robot.yml, ahead of the folder.
    expect(indexOf('Servo Arm')).toBe(0)
    // What you will need comes before anything that assumes you have it (#1157).
    expect(indexOf(BOM_HEADING)).toBe(1)
    expect(indexOf('Blocks')).toBe(2)
    expect(indexOf('Blocks')).toBeLessThan(indexOf('MicroPython'))
    expect(indexOf('MicroPython')).toBeLessThan(indexOf('Electronics'))
    expect(indexOf('Electronics')).toBeLessThan(lastIndexOf('Made with Snakie'))
    expect(lastIndexOf('Support Snakie')).toBe(text.length - 1)
    expect(result.omitted).toEqual([])
  })

  it('numbers every page but the cover, and counts them all', async () => {
    const result = await buildProjectPdf(
      { robot: demoRobot(), folder: DEMO, code: { stored: demoCode() } },
      { art: art({ wiring: async () => diagram }) }
    )
    const text = textOfPages(result.bytes)
    expect(text).toHaveLength(result.pageCount)
    expect(text[0].some((s) => s.startsWith('Page '))).toBe(false)
    for (let i = 1; i < text.length; i++) {
      expect(text[i]).toContain(`Page ${i + 1} of ${result.pageCount}`)
    }
  })

  it('opens every section with a line saying what to do with it (#1157)', async () => {
    const result = await buildProjectPdf(
      {
        robot: demoRobot(),
        folder: DEMO,
        code: { stored: demoCode() },
        catalog: { boards: [{ id: 'pico', name: 'Raspberry Pi Pico' }] }
      },
      {
        art: art({
          blockStacks: async () => [stack('main', 'Main program')],
          wiring: async () => diagram
        })
      }
    )
    const flat = textOfPages(result.bytes).map((p) => p.join(' '))
    const says = (needle: string): boolean => flat.some((p) => p.includes(needle))
    expect(says(BOM_INTRO)).toBe(true)
    expect(says(BLOCKS_INTRO)).toBe(true)
    // The wiring line wraps, so it is the opening of it that is one string.
    expect(says('Wire up the robot like the picture below')).toBe(true)
    expect(says(CODE_INTRO_WITH_BLOCKS.slice(0, 60))).toBe(true)
  })

  it('offers the listing as an alternative only to a reader who was given blocks', async () => {
    const withoutBlocks = await buildProjectPdf({ code: { stored: 'print(1)' } })
    const flat = textOfPages(withoutBlocks.bytes).map((p) => p.join(' '))
    expect(flat.some((p) => p.includes(CODE_INTRO.slice(0, 50)))).toBe(true)
    expect(flat.some((p) => p.includes(CODE_INTRO_WITH_BLOCKS.slice(0, 50)))).toBe(false)
  })

  it('names the bill of materials from the installed libraries', async () => {
    const result = await buildProjectPdf({
      robot: demoRobot(),
      code: { stored: 'x = 1' },
      catalog: {
        libraries: [
          {
            id: 'snakie-standard',
            name: 'Snakie standard',
            parts: [
              { id: 'sg90', name: 'SG90 micro servo', manufacturer: 'TowerPro', headers: [] }
            ]
          }
        ],
        boards: [{ id: 'pico', name: 'Raspberry Pi Pico' }]
      }
    })
    const bom = textOfPages(result.bytes)[1]
    expect(bom).toContain('Raspberry Pi Pico')
    expect(bom).toContain('SG90 micro servo')
    expect(bom).toContain('2×')
  })

  it('has no shopping list when there is no project model to shop from', async () => {
    const result = await buildProjectPdf({ code: { stored: 'print(1)' } })
    const flat = textOfPages(result.bytes).map((p) => p.join(' '))
    expect(flat.some((p) => p.includes(BOM_HEADING))).toBe(false)
    expect(flat.some((p) => p.includes(BOM_INTRO))).toBe(false)
  })

  it('closes with the two real links', async () => {
    const result = await buildProjectPdf({ code: { stored: 'print(1)' } })
    const pdf = parsePdf(result.bytes)
    const last = pages(pdf)[pages(pdf).length - 1]
    expect(pageLinks(pdf, last)).toEqual([SNAKIE_WEB_URL, COFFEE_URL])
  })
})

describe('the electronics page (#1147, #1168)', () => {
  it('shows the board ONCE — it used to print the same diagram twice', async () => {
    const result = await buildProjectPdf(
      { robot: demoRobot(), code: { stored: demoCode() } },
      { art: art({ wiring: async () => diagram }) }
    )
    const flat = textOfPages(result.bytes).map((p) => p.join(' '))
    expect(flat.filter((p) => p.includes('Electronics'))).toHaveLength(1)
    // …and the picture itself is placed once, not drawn onto a second page.
    const pdf = parsePdf(result.bytes)
    const drawn = pages(pdf)
      .flatMap((page) => [...pageImages(pdf, page).values()])
      .map((obj) => Number(/\/Length\s+(\d+)/.exec(obj.body)?.[1]))
    expect(drawn.filter((len) => len === 128)).toHaveLength(1)
  })

  it('asks for the board exactly once', async () => {
    const wiring = vi.fn(async () => diagram)
    await buildProjectPdf({ robot: demoRobot(), code: { stored: 'x = 1' } }, { art: art({ wiring }) })
    expect(wiring).toHaveBeenCalledTimes(1)
  })

  it('is not asked for at all by a project with no parts', async () => {
    const wiring = vi.fn(async () => diagram)
    await buildProjectPdf({ robot: blankRobot(), code: { stored: 'x = 1' } }, { art: art({ wiring }) })
    expect(wiring).not.toHaveBeenCalled()
  })
})

describe('the connections table (#1170)', () => {
  it('follows the diagram, so the picture comes before the list', async () => {
    const result = await buildProjectPdf(
      { robot: demoRobot(), code: { stored: demoCode() } },
      { art: art({ wiring: async () => diagram }) }
    )
    const flat = textOfPages(result.bytes).map((p) => p.join(' '))
    const diagramPage = flat.findIndex((p) => p.includes('Electronics'))
    const tablePage = flat.findIndex((p) => p.includes(CONNECTIONS_HEADING))
    expect(diagramPage).toBeGreaterThan(0)
    expect(tablePage).toBe(diagramPage + 1)
    expect(flat[tablePage]).toContain(CONNECTIONS_INTRO.slice(0, 30))
  })

  it('writes out every wire in the project', async () => {
    const result = await buildProjectPdf(
      { robot: demoRobot(), code: { stored: 'x = 1' } },
      { art: art({ wiring: async () => diagram }) }
    )
    const flat = textOfPages(result.bytes)
      .map((p) => p.join(' '))
      .join(' ')
    for (const row of buildConnections(demoRobot())) {
      expect(flat).toContain(row.to)
    }
  })

  it('stands on its own when the board could not be captured', async () => {
    // The one case where the reader would otherwise have no wiring at all.
    const result = await buildProjectPdf(
      { robot: demoRobot(), code: { stored: 'x = 1' } },
      { art: art({ wiring: async () => null }) }
    )
    const flat = textOfPages(result.bytes).map((p) => p.join(' '))
    expect(flat.some((p) => p.includes(CONNECTIONS_HEADING))).toBe(true)
    expect(result.omitted).toEqual([{ section: 'wiring', reason: expect.any(String) }])
  })

  it('is left out by a project with no wiring', async () => {
    const result = await buildProjectPdf({ robot: blankRobot(), code: { stored: 'x = 1' } })
    const flat = textOfPages(result.bytes).map((p) => p.join(' '))
    expect(flat.some((p) => p.includes(CONNECTIONS_HEADING))).toBe(false)
  })
})

describe('skipping sections', () => {
  it('a blocks-only project gets no wiring page', async () => {
    const result = await buildProjectPdf(
      { robot: blankRobot(), code: { generated: 'led.on()' } },
      { art: art({ blockStacks: async () => [stack('a')], wiring: async () => diagram }) }
    )
    const flat = textOfPages(result.bytes).map((p) => p.join(' '))
    expect(flat.some((p) => p.includes('Blocks'))).toBe(true)
    expect(flat.some((p) => p.includes('Electronics'))).toBe(false)
    expect(result.omitted).toEqual([])
  })

  it('a wiring-only project gets no blocks pages', async () => {
    const result = await buildProjectPdf(
      { robot: demoRobot(), code: { stored: demoCode() } },
      { art: art({ wiring: async () => diagram }) }
    )
    const flat = textOfPages(result.bytes).map((p) => p.join(' '))
    expect(flat.some((p) => p.includes('Blocks'))).toBe(false)
    expect(flat.some((p) => p.includes('Electronics'))).toBe(true)
  })

  it('an empty project is a cover and a closing page, and still a valid document', async () => {
    const result = await buildProjectPdf({})
    expect(result.pageCount).toBe(2)
    expect(result.projectName).toBe('Untitled project')
    const text = textOfPages(result.bytes)
    expect(text[0].join(' ')).toContain('Untitled project')
    expect(text[1].join(' ')).toContain('Made with Snakie')
    expect(text[1]).toContain('Page 2 of 2')
  })

  it('leaves no blank page where a section was skipped', async () => {
    const result = await buildProjectPdf({ code: { stored: '' } })
    for (const page of textOfPages(result.bytes)) expect(page.length).toBeGreaterThan(0)
  })
})

describe('when one section fails', () => {
  it('still produces a document, and says what it left out', async () => {
    const result = await buildProjectPdf(
      { robot: demoRobot(), code: { stored: demoCode() } },
      {
        art: art({
          wiring: async () => {
            throw new Error('the breadboard would not rasterise')
          }
        })
      }
    )
    expect(result.pageCount).toBeGreaterThan(2)
    expect(result.omitted).toEqual([
      { section: 'wiring', reason: 'the breadboard would not rasterise' }
    ])
    const flat = textOfPages(result.bytes).map((p) => p.join(' '))
    expect(flat.some((p) => p.includes('MicroPython'))).toBe(true)
    expect(flat.some((p) => p.includes('Made with Snakie'))).toBe(true)
  })

  it('reports a breadboard that captured as nothing rather than printing a blank', async () => {
    const result = await buildProjectPdf(
      { robot: demoRobot(), code: { stored: 'x = 1' } },
      { art: art({ wiring: async () => null }) }
    )
    expect(result.omitted).toEqual([
      { section: 'wiring', reason: 'the breadboard could not be captured' }
    ])
    expect(
      textOfPages(result.bytes)
        .map((p) => p.join(' '))
        .some((p) => p.includes('Electronics'))
    ).toBe(false)
  })

  it('carries on without the blocks pages when the canvas throws', async () => {
    const result = await buildProjectPdf(
      { code: { stored: 'x = 1' } },
      {
        art: art({
          blockStacks: async () => {
            throw new Error('no workspace')
          }
        })
      }
    )
    expect(result.omitted).toEqual([{ section: 'blocks', reason: 'no workspace' }])
    expect(result.pageCount).toBeGreaterThan(1)
  })

  it('does not ask for a diagram a project has no parts for', async () => {
    const wiring = vi.fn(async () => diagram)
    await buildProjectPdf(
      { robot: blankRobot(), code: { stored: 'x = 1' } },
      { art: art({ wiring }) }
    )
    expect(wiring).not.toHaveBeenCalled()
  })
})

describe('the file it produces', () => {
  it('names itself after the project', async () => {
    const result = await buildProjectPdf({ robot: { ...blankRobot(), name: 'Servo Arm!' } })
    expect(result.fileName).toBe('servo-arm.pdf')
  })

  it('falls back to a usable stem', () => {
    expect(fileStem('  ')).toBe('project')
    expect(fileStem('///')).toBe('project')
    expect(fileStem('Line Follower v2')).toBe('line-follower-v2')
  })

  it('is reproducible byte for byte with the same inputs', async () => {
    const build = (): Promise<{ bytes: Uint8Array }> =>
      buildProjectPdf(
        {
          robot: demoRobot(),
          folder: DEMO,
          code: { stored: demoCode() },
          date: new Date(2026, 8, 19)
        },
        {
          art: art({
            blockStacks: async () => [stack('a', 'Main program')],
            wiring: async () => diagram
          })
        }
      )
    expect(latin1((await build()).bytes)).toBe(latin1((await build()).bytes))
  })

  it('every xref offset in the finished file resolves', async () => {
    // parsePdf throws on any offset that misses; this re-checks the core
    // writer's invariant on a real, full document.
    const result = await buildProjectPdf(
      {
        robot: demoRobot(),
        folder: DEMO,
        code: { stored: demoCode() },
        date: new Date(2026, 8, 19)
      },
      {
        art: art({
          blockStacks: async () => [stack('f', 'Function: sweep'), stack('m', 'Main program')],
          wiring: async () => diagram
        })
      }
    )
    const pdf = parsePdf(result.bytes)
    expect(pdf.objects.size).toBe(pdf.size - 1)
    expect(pages(pdf)).toHaveLength(result.pageCount)
  })

  it('reports progress from start to finish', async () => {
    const seen: number[] = []
    await buildProjectPdf(
      { code: { stored: 'x = 1' } },
      { onProgress: (p) => seen.push(p.fraction) }
    )
    expect(seen[0]).toBeGreaterThan(0)
    expect(seen[seen.length - 1]).toBe(1)
    expect([...seen].sort((a, b) => a - b)).toEqual(seen)
  })
})
