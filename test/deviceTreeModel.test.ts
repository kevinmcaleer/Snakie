import { describe, it, expect } from 'vitest'
import {
  flattenTree,
  isSameOrDescendant,
  joinDevicePath,
  nextSelection,
  parentDevicePath,
  planMove,
  pruneNested
} from '../src/renderer/src/components/device-tree-model'
import type { DirEntry } from '../src/preload/index.d'

const d = (name: string): DirEntry => ({ name, isDir: true })
const f = (name: string): DirEntry => ({ name, isDir: false })

const dirs = new Map<string, DirEntry[]>([
  ['/', [d('lib'), f('main.py'), f('boot.py')]],
  ['/lib', [f('servo.py'), f('bme280.py')]]
])

describe('device tree flatten (#219)', () => {
  it('walks visible rows depth-first, honouring expansion', () => {
    const collapsed = flattenTree(dirs, new Set())
    expect(collapsed.map((r) => r.path)).toEqual(['/lib', '/main.py', '/boot.py'])
    const open = flattenTree(dirs, new Set(['/lib']))
    expect(open.map((r) => r.path)).toEqual(['/lib', '/lib/servo.py', '/lib/bme280.py', '/main.py', '/boot.py'])
    expect(open[1].depth).toBe(1)
    expect(open[3].depth).toBe(0)
  })
  it('an expanded but unloaded dir contributes nothing', () => {
    expect(flattenTree(dirs, new Set(['/nope'])).length).toBe(3)
  })
})

describe('selection transitions (#219)', () => {
  const rows = flattenTree(dirs, new Set(['/lib']))
  it('single click selects only that row', () => {
    const r = nextSelection(new Set(['/main.py']), '/main.py', rows, '/boot.py', 'single')
    expect([...r.selection]).toEqual(['/boot.py'])
    expect(r.anchor).toBe('/boot.py')
  })
  it('ctrl/cmd toggles membership', () => {
    const on = nextSelection(new Set(['/main.py']), '/main.py', rows, '/boot.py', 'toggle')
    expect(on.selection).toEqual(new Set(['/main.py', '/boot.py']))
    const off = nextSelection(on.selection, on.anchor, rows, '/main.py', 'toggle')
    expect(off.selection).toEqual(new Set(['/boot.py']))
  })
  it('shift selects the visible range from the anchor (either direction)', () => {
    const down = nextSelection(new Set(['/lib']), '/lib', rows, '/main.py', 'range')
    expect(down.selection).toEqual(new Set(['/lib', '/lib/servo.py', '/lib/bme280.py', '/main.py']))
    expect(down.anchor).toBe('/lib') // anchor sticks for further ranges
    const up = nextSelection(new Set(['/main.py']), '/main.py', rows, '/lib/servo.py', 'range')
    expect(up.selection).toEqual(new Set(['/lib/servo.py', '/lib/bme280.py', '/main.py']))
  })
  it('shift with no anchor falls back to single', () => {
    const r = nextSelection(new Set(), null, rows, '/main.py', 'range')
    expect([...r.selection]).toEqual(['/main.py'])
  })
})

describe('move planning (#219)', () => {
  it('plans a rename per source into the destination', () => {
    expect(planMove(['/main.py', '/boot.py'], '/lib')).toEqual([
      { from: '/main.py', to: '/lib/main.py' },
      { from: '/boot.py', to: '/lib/boot.py' }
    ])
  })
  it('skips no-ops and illegal folder-into-itself moves', () => {
    expect(planMove(['/lib/servo.py'], '/lib')).toEqual([]) // already there
    expect(planMove(['/lib'], '/lib')).toEqual([]) // into itself
    expect(planMove(['/lib'], '/lib/sub')).toEqual([]) // into its own child
  })
  it('drops sources nested under another dragged source', () => {
    expect(planMove(['/lib', '/lib/servo.py'], '/x')).toEqual([{ from: '/lib', to: '/x/lib' }])
  })
})

describe('path helpers (#219)', () => {
  it('join/parent round-trip', () => {
    expect(joinDevicePath('/', 'a.py')).toBe('/a.py')
    expect(joinDevicePath('/lib', 'a.py')).toBe('/lib/a.py')
    expect(parentDevicePath('/lib/a.py')).toBe('/lib')
    expect(parentDevicePath('/a.py')).toBe('/')
  })
  it('descendant + prune', () => {
    expect(isSameOrDescendant('/lib', '/lib/x/y')).toBe(true)
    expect(isSameOrDescendant('/lib', '/library')).toBe(false)
    expect(pruneNested(['/lib', '/lib/servo.py', '/main.py'])).toEqual(['/lib', '/main.py'])
  })
})
