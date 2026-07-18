import { describe, it, expect } from 'vitest'
import { createElement, type FunctionComponent } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { INSTRUMENTS, type InstrumentDef } from '../src/renderer/src/components/instruments-registry'
import { WifiScanInstrument } from '../src/renderer/src/components/WifiScanInstrument'
import { BluetoothInstrument } from '../src/renderer/src/components/BluetoothInstrument'
import { BuzzerInstrument } from '../src/renderer/src/components/BuzzerInstrument'
import { DisplayInstrument } from '../src/renderer/src/components/DisplayInstrument'
import { SamInstrument } from '../src/renderer/src/components/SamInstrument'
import { RangeInstrument } from '../src/renderer/src/components/RangeInstrument'

/**
 * A detached instrument OS window has NO WorkspaceProvider. Rendering these
 * components with no provider mimics that pop-out. Before the fix they called the
 * throwing `useWorkspace()`, so the render threw and the pop-out window was BLANK.
 * Now they read the workspace optionally, so they render. Server-render is enough:
 * `useEffect` (the telemetry subscription / any `window.api` use) does not run, so
 * no board/DOM is needed — a throw here is exactly the blank-window crash.
 */
const defOf = (id: string): InstrumentDef => {
  const d = INSTRUMENTS.find((x) => x.id === id)
  if (!d) throw new Error(`no instrument def for ${id}`)
  return d
}

const cases: [string, FunctionComponent<{ def: InstrumentDef }>][] = [
  ['wifi-scan', WifiScanInstrument],
  ['bluetooth', BluetoothInstrument],
  ['buzzer', BuzzerInstrument],
  ['i2c-display', DisplayInstrument],
  ['sam', SamInstrument],
  ['range', RangeInstrument]
]

describe('instruments render in a detached window (no WorkspaceProvider)', () => {
  for (const [id, Comp] of cases) {
    it(`${id} renders without a workspace provider (not a blank pop-out)`, () => {
      const def = defOf(id)
      const html = renderToStaticMarkup(createElement(Comp, { def }))
      expect(html.length).toBeGreaterThan(0)
      expect(html).toContain(def.name.toUpperCase()) // the title-bar name is drawn
    })
  }
})
