import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { DataLoggerInstrument } from '../src/renderer/src/components/DataLoggerInstrument'
import { instrumentById, INSTRUMENTS } from '../src/renderer/src/components/instruments-registry'
import { emptySession, foldReading } from '../src/renderer/src/components/logger-logic'
import { parseTelemetry } from '../src/renderer/src/components/instrument-telemetry'

const def = instrumentById('logger')!

describe('Data Logger instrument (#242)', () => {
  it('registers the logger singleton', () => {
    expect(def).toBeDefined()
    expect(def.kind).toBe('singleton')
    expect(def.name).toBe('Data Logger')
    expect(INSTRUMENTS.filter((d) => d.id === 'logger')).toHaveLength(1)
  })

  it('with NO data still shows the printer head (RECORD reachable) + a how-to hint', () => {
    const html = renderToStaticMarkup(createElement(DataLoggerInstrument, { def, docked: true }))
    // The empty paper carries the how-to hint…
    expect(html).toContain('Nothing logged yet')
    expect(html).toContain('inst.plot')
    // …but the RECORD button is present so you can arm before any telemetry.
    expect(html).toContain('● REC')
    expect(html).toContain('dlog__paper--empty')
  })

  it('with a seeded session draws the printer: chart trace + printed rows', () => {
    const session = emptySession()
    foldReading(session, parseTelemetry('SNK PLOT temp=21 light=880')!, 200)
    foldReading(session, parseTelemetry('SNK PLOT temp=22 light=875')!, 1200)
    foldReading(session, parseTelemetry('SNK PLOT temp=23 light=860')!, 2200)
    const html = renderToStaticMarkup(
      createElement(DataLoggerInstrument, { def, docked: true, initialSession: session })
    )
    // Printer chrome + tractor-feed paper.
    expect(html).toContain('dlog__paper')
    expect(html).toContain('DMP-242')
    expect(html).toContain('TEAR OFF')
    // A strip-chart trace rendered for a series.
    expect(html).toContain('dlog__trace')
    // Printed value rows carry the short series names.
    expect(html).toContain('temp=')
    expect(html).toContain('light=')
  })
})
