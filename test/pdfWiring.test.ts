import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { PdfDocument } from '../src/renderer/src/lib/pdf/layout'
import {
  drawWiringPage,
  hasWiring,
  wiringSummary
} from '../src/renderer/src/lib/pdf/sections/wiring'
import { blankRobot } from '../src/shared/robot'
import { robotFromYaml } from '../src/shared/robot-yaml'
import { WIRING_INTRO } from '../src/renderer/src/lib/pdf/sections/narrative'
import { pageContent, pageStrings, pages, parsePdf } from './helpers/pdf-inspect'

/** The electronics wiring diagram page (#1110). */

/** The demo project's wiring — the same file `demoProjectFiles.test.ts` guards. */
function demoRobot(): ReturnType<typeof robotFromYaml> {
  return robotFromYaml(
    readFileSync(join(__dirname, '..', 'examples', 'servo-arm', 'robot.yml'), 'utf-8')
  )
}

describe('deciding whether there is a page at all', () => {
  it('skips a project with no robot.yml', () => {
    expect(hasWiring(null)).toBe(false)
    expect(hasWiring(undefined)).toBe(false)
  })

  it('skips a robot.yml with no parts', () => {
    expect(hasWiring(blankRobot())).toBe(false)
    // …even one that somehow has connections but nothing to connect.
    expect(hasWiring({ ...blankRobot(), connections: [] })).toBe(false)
  })

  it('draws the demo project, which has real wiring', () => {
    const robot = demoRobot()
    expect(robot.parts.length).toBeGreaterThan(0)
    expect(hasWiring(robot)).toBe(true)
  })
})

describe('the summary line', () => {
  it('counts parts and connections, with English plurals', () => {
    const robot = demoRobot()
    expect(wiringSummary(robot)).toBe(
      `${robot.parts.length} parts · ${robot.connections.length} connections`
    )
    expect(wiringSummary({ ...blankRobot(), parts: [{ id: 'a' }] as never })).toBe(
      '1 part · 0 connections'
    )
  })
})

describe('drawing the page', () => {
  const doc = (): PdfDocument => new PdfDocument()
  const art = (
    width: number,
    height: number
  ): { image: ReturnType<PdfDocument['addImage']>; width: number; height: number } => {
    const d = doc()
    return { image: d.addImage({ jpeg: new Uint8Array(8), width: 10, height: 10 }), width, height }
  }

  it('leaves nothing blank behind when there is no art', () => {
    const d = doc()
    expect(drawWiringPage(d, null)).toBeNull()
    expect(d.pageCount).toBe(0)
  })

  it('refuses art with no measurable size rather than printing an empty page', () => {
    const d = doc()
    const image = d.addImage({ jpeg: new Uint8Array(8), width: 10, height: 10 })
    expect(drawWiringPage(d, { image, width: 0, height: 0 })).toBeNull()
    expect(d.pageCount).toBe(0)
  })

  it('scales the diagram to fit its content box without distortion', () => {
    const d = doc()
    const image = d.addImage({ jpeg: new Uint8Array(8), width: 10, height: 10 })
    const page = drawWiringPage(d, { image, width: 4000, height: 1000 })
    expect(page).not.toBeNull()
    const pdf = parsePdf(d.build())
    // The `cm` matrix carries the placed size; the aspect must survive it.
    const cm = /([\d.]+) 0 0 ([\d.]+) [\d.]+ [\d.]+ cm/.exec(pdf.raw)
    expect(cm).toBeTruthy()
    expect(Number(cm![1]) / Number(cm![2])).toBeCloseTo(4, 3)
    expect(Number(cm![1])).toBeLessThanOrEqual(page!.content.width + 0.001)
  })

  it('heads the page and can carry a summary', () => {
    const d = doc()
    const image = d.addImage({ jpeg: new Uint8Array(8), width: 10, height: 10 })
    drawWiringPage(d, { image, width: 800, height: 600 }, { summary: '6 parts · 11 connections' })
    const pdf = parsePdf(d.build())
    const strings = pageStrings(pdf, pages(pdf)[0])
    expect(strings).toContain('Electronics')
    expect(strings).toContain('6 parts · 11 connections')
    expect(strings).toContain('Page 1 of 1')
  })

  it('is one page, whatever the diagram', () => {
    const d = doc()
    const a = art(100, 100)
    drawWiringPage(d, {
      image: d.addImage({ jpeg: new Uint8Array(8), width: 10, height: 10 }),
      width: a.width,
      height: a.height
    })
    expect(d.pageCount).toBe(1)
  })
})

describe('the line above the picture (#1157)', () => {
  const art = { image: { index: 0, width: 600, height: 400 }, width: 600, height: 400 }

  it('says how to wire it up, above the diagram and before the caption', () => {
    const doc = new PdfDocument()
    drawWiringPage(doc, art, { intro: WIRING_INTRO, summary: '2 parts · 6 connections' })
    const pdf = parsePdf(doc.build())
    const text = pageStrings(pdf, pages(pdf)[0]).join(' ')
    expect(text).toContain('Wire up the robot like the picture below')
    expect(text).toContain('DuPont')
    expect(text).toContain('2 parts · 6 connections')
  })

  it('takes the room for it out of the picture, not off the bottom of the page', () => {
    // A TALL diagram, so the page's height is what limits it and the intro's
    // room is visible in the scale.
    const tall = { image: { index: 0, width: 300, height: 900 }, width: 300, height: 900 }
    const withIntro = new PdfDocument()
    drawWiringPage(withIntro, tall, { intro: WIRING_INTRO })
    const without = new PdfDocument()
    drawWiringPage(without, tall, {})
    const heightOf = (doc: PdfDocument): number => {
      const pdf = parsePdf(doc.build())
      const content = pages(pdf)[0]
      const drawn = /([\d.]+) 0 0 ([\d.]+) [\d.]+ ([\d.]+) cm/.exec(
        pageContent(pdf, content)
      )
      return Number(drawn?.[2] ?? 0)
    }
    expect(heightOf(withIntro)).toBeGreaterThan(0)
    expect(heightOf(withIntro)).toBeLessThan(heightOf(without))
  })
})
