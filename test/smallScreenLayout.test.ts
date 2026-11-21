import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  COMPACT_MAX_WIDTH,
  PHONE_MAX_HEIGHT,
  PHONE_MAX_WIDTH,
  viewportSizeFor
} from '../src/renderer/src/hooks/useViewportSize'
import { easeOutCubic, tweenValue } from '../src/renderer/src/hooks/useAnimatedNumber'
import { isTouchTap, TOUCH_TAP_SLOP } from '../src/renderer/src/components/MiniBoardView'

describe('viewportSizeFor (small-screen layout)', () => {
  it('keeps the desktop layout above the compact breakpoint', () => {
    expect(viewportSizeFor(1440)).toBe('wide')
    expect(viewportSizeFor(COMPACT_MAX_WIDTH + 1)).toBe('wide')
  })

  it('uses the compact layout for small laptops and tablets', () => {
    expect(viewportSizeFor(COMPACT_MAX_WIDTH)).toBe('compact')
    expect(viewportSizeFor(1024)).toBe('compact')
    expect(viewportSizeFor(768)).toBe('compact')
    expect(viewportSizeFor(PHONE_MAX_WIDTH + 1)).toBe('compact')
  })

  it('uses the phone layout at phone widths', () => {
    expect(viewportSizeFor(PHONE_MAX_WIDTH)).toBe('phone')
    expect(viewportSizeFor(390)).toBe('phone')
  })

  it('treats a phone on its side as a phone, not a small tablet', () => {
    // iPhone 17 Pro Max landscape: 956 wide, ~370–440 tall.
    expect(viewportSizeFor(956, 440)).toBe('phone')
    expect(viewportSizeFor(956, 367)).toBe('phone')
    expect(viewportSizeFor(667, PHONE_MAX_HEIGHT)).toBe('phone')
  })

  it('leaves tablets and short DESKTOP windows alone', () => {
    expect(viewportSizeFor(1024, 768)).toBe('compact')
    expect(viewportSizeFor(768, PHONE_MAX_HEIGHT + 1)).toBe('compact')
    // A wide window squashed short is still a desktop with a mouse.
    expect(viewportSizeFor(1440, 400)).toBe('wide')
  })
})

describe('tweenValue (mini board smooth zoom)', () => {
  it('starts at the start value and lands exactly on the target', () => {
    expect(tweenValue(1, 1.25, 0, 200)).toBe(1)
    expect(tweenValue(1, 1.25, 200, 200)).toBe(1.25)
    expect(tweenValue(1, 1.25, 500, 200)).toBe(1.25)
  })

  it('moves monotonically toward the target in between', () => {
    const steps = [40, 80, 120, 160].map((t) => tweenValue(1, 2, t, 200))
    for (let i = 1; i < steps.length; i++) expect(steps[i]).toBeGreaterThan(steps[i - 1])
    expect(steps[0]).toBeGreaterThan(1)
    expect(steps[3]).toBeLessThan(2)
  })

  it('also eases when zooming out', () => {
    const mid = tweenValue(2, 1, 100, 200)
    expect(mid).toBeLessThan(2)
    expect(mid).toBeGreaterThan(1)
  })

  it('snaps when there is no duration', () => {
    expect(tweenValue(1, 3, 0, 0)).toBe(3)
  })

  it('easeOutCubic is clamped to [0, 1]', () => {
    expect(easeOutCubic(-1)).toBe(0)
    expect(easeOutCubic(2)).toBe(1)
    expect(easeOutCubic(0.5)).toBeCloseTo(0.875)
  })
})

describe('mini board touch pinout', () => {
  it('treats a small drift as a tap/hold and a longer drag as a pan', () => {
    expect(isTouchTap(0, 0)).toBe(true)
    expect(isTouchTap(6, 6)).toBe(true)
    expect(isTouchTap(TOUCH_TAP_SLOP, 0)).toBe(true)
    expect(isTouchTap(TOUCH_TAP_SLOP + 1, 0)).toBe(false)
    expect(isTouchTap(0, -40)).toBe(false)
  })
})

describe('side panels beside Electronics and Build', () => {
  const shell = readFileSync('src/renderer/src/components/AppShell.tsx', 'utf8')
  const shellCss = readFileSync('src/renderer/src/components/AppShell.css', 'utf8')

  it('opens Files, Packages and Search there instead of ignoring the tap', () => {
    // The non-lesson branch used to only remember the view and keep the panel shut.
    expect(shell).toMatch(/setSoloSide\(\(open\) => \(open === view/)
    expect(shell).toMatch(
      /const soloPanelOpen = soloLessonOpen \|\| \(soloWorkspace && soloSide === activityView\)/
    )
    expect(shell).toMatch(/\{soloPanelOpen && \(\s*<aside className="shell__solo-lesson"/)
  })

  it('forgets the panel when the workspace changes', () => {
    expect(shell).toMatch(/useEffect\(\(\) => setSoloSide\(null\), \[layout\.active\]\)/)
  })

  it('shows it as a drawer above the workspace controls on small screens', () => {
    const i = shellCss.indexOf(".shell:not([data-size='wide']) .shell__solo-lesson {")
    expect(i).toBeGreaterThan(-1)
    const rule = shellCss.slice(i, shellCss.indexOf('}', i))
    expect(rule).toMatch(/position:\s*absolute/)
    expect(rule).toMatch(/z-index:\s*90/)
    expect(shellCss).toMatch(/\.shell__solo--overlay > \.shell__scrim \{\s*z-index:\s*89/)
  })
})

describe('Electronics on a phone: one arrangement, nothing adrift', () => {
  const css = readFileSync('src/renderer/src/components/BoardGraph.small.css', 'utf8')
  const pane = readFileSync('src/renderer/src/components/BoardPane.tsx', 'utf8')
  const graph = readFileSync('src/renderer/src/components/BoardGraph.tsx', 'utf8')
  const P = ".shell[data-size='phone'] .shell__solo-board"
  const rule = (sel: string): string => {
    const i = css.indexOf(`${P} ${sel} {`)
    expect(i, sel).toBeGreaterThan(-1)
    return css.slice(i, css.indexOf('}', i))
  }

  it('keeps Sync in the header row, not floating over the board', () => {
    expect(pane).toMatch(/headerActions=\{<SyncControl folder=\{folder\} \/>\}/)
    expect(pane).not.toMatch(/esync__float/)
    expect(graph).toMatch(/\{headerActions\}/)
    expect(css).not.toMatch(/esync__float/)
  })

  it('lays the header actions out as one full-width row', () => {
    expect(rule('.boardgraph__actions')).toMatch(/flex:\s*1 1 100%/)
    expect(rule('.boardgraph__actions > *')).toMatch(/flex:\s*1 1 0/)
  })

  it('docks the tool bar across the bottom and the part tools on top of it', () => {
    const dock = rule('.wc__controls')
    expect(dock).toMatch(/left:\s*var\(--em-edge\)/)
    expect(dock).toMatch(/right:\s*var\(--em-edge\)/)
    const i = css.indexOf(`${P} .wc__parttb,`)
    const tb = css.slice(i, css.indexOf('}', i))
    expect(tb).toMatch(/top:\s*auto !important/)
    expect(tb).toMatch(/transform:\s*none/)
  })

  it('gives Library the same board chrome as the menu button', () => {
    expect(rule('.boardgraph__dock-tab')).toMatch(/background:\s*rgba\(12, 20, 28, 0\.82\)/)
  })

  it('never shows a greyed-out undo or redo', () => {
    expect(rule('.wc__zoom-btn:disabled')).toMatch(/visibility:\s*hidden/)
  })
})

describe('a held finger on a part in Build opens its menu', () => {
  const view = readFileSync('src/renderer/src/components/RobotView.tsx', 'utf8')
  const panel = readFileSync('src/renderer/src/components/RobotBuildPanel.tsx', 'utf8')
  const css = readFileSync('src/renderer/src/components/RobotView.css', 'utf8')

  it('listens for a hold and a right-click on the 3-D view', () => {
    expect(view).toMatch(/addEventListener\('pointerdown', onHoldDown\)/)
    expect(view).toMatch(/addEventListener\('contextmenu', onPartContextMenu\)/)
    expect(view).toMatch(/if \(fingers !== 1\) return/)
    expect(view).toMatch(/<RobotBuildPanel\s+menuRequest=\{partMenuReq\}/)
  })

  it('shows the menu even with the Build panel shut', () => {
    const closed = panel.slice(panel.indexOf('if (!open) {'), panel.indexOf('<aside'))
    expect(closed).toMatch(/\{partMenu\}/)
  })

  it('offers no greyed-out item, and says what to do about the base', () => {
    const items = panel.slice(panel.indexOf('const menuItems'), panel.indexOf('const activeKey'))
    expect(items).not.toMatch(/disabled/)
    expect(view).toMatch(/make another part the base first, then delete this one/)
  })

  it('turns off text selection and the iOS callout on touch screens', () => {
    const i = css.indexOf('@media (pointer: coarse)')
    expect(i).toBeGreaterThan(-1)
    const block = css.slice(i)
    expect(block).toMatch(/-webkit-touch-callout:\s*none/)
    // Safari ignores the unprefixed property on its own.
    expect(block).toMatch(/-webkit-user-select:\s*none/)
  })
})
