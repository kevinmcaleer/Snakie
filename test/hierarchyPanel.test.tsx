import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { HierarchyPanel } from '../src/renderer/src/components/HierarchyPanel'
import {
  massCoverage,
  unifiedTree,
  type HierarchyNode,
  type HierarchyWorkspace
} from '../src/renderer/src/components/hierarchy-tree'
import { addBoxLink, blankUrdf, setInertial } from '../src/renderer/src/components/robot-assembly'

/**
 * The shared hierarchy panel (#718) rendered to static markup — the same check
 * the other component tests use (vitest runs in node; SSR markup is exactly
 * what the browser mounts).
 *
 * The headline property is the epic's promise: rendering the SAME nodes in
 * Electronics and in Build produces the SAME rows, in the same order, at the
 * same depth. The only permitted difference is that Build-only rows go dimmed
 * and inert in Electronics.
 */

/** A model with a base, a jointed part body, a spare structural link. */
function fixtureNodes(): HierarchyNode[] {
  let urdf = blankUrdf('bot')
  urdf = addBoxLink(urdf, { linkBase: 'SG90', size: [0.02, 0.02, 0.01] }).urdf
  urdf = addBoxLink(urdf, { linkBase: 'bracket', size: [0.02, 0.02, 0.01] }).urdf
  urdf = setInertial(urdf, 'SG90', { mass: 0.009, com: [0, 0, 0] })
  return unifiedTree({
    board: 'Pico',
    parts: [
      { id: 's1', lib: 'std', part: 'sg90', label: 'Left servo', urdfLink: 'SG90' },
      { id: 'd1', lib: 'std', part: 'oled', label: 'Display' }
    ],
    urdf
  })
}

const render = (workspace: HierarchyWorkspace, over?: Partial<Parameters<typeof HierarchyPanel>[0]>): string =>
  renderToStaticMarkup(
    <HierarchyPanel
      nodes={fixtureNodes()}
      workspace={workspace}
      selectedKey={null}
      onSelect={() => {}}
      open
      onToggleOpen={() => {}}
      onEdit={() => {}}
      onRemove={() => {}}
      {...over}
    />
  )

/** Row labels in render order — the tree's structure, flattened. */
const labels = (html: string): string[] =>
  [...html.matchAll(/<span class="uhier__label">([^<]*)<\/span>/g)].map((m) => m[1])

/** Every row's class list, in render order. */
const rowClasses = (html: string): string[] =>
  [...html.matchAll(/<div class="(uhier__row[^"]*)"/g)].map((m) => m[1])

describe('HierarchyPanel — one tree, both workspaces', () => {
  it('renders the SAME rows, in the same order, in Electronics and Build', () => {
    expect(labels(render('electronics'))).toEqual(labels(render('build')))
  })

  it('nests identically in both — same depth for every row', () => {
    const nesting = (html: string): number => (html.match(/uhier__list--nested/g) ?? []).length
    expect(nesting(render('electronics'))).toBe(nesting(render('build')))
    expect(nesting(render('build'))).toBeGreaterThan(0) // the fixture really is nested
  })

  it('shows Build-only rows in Electronics too — dimmed, not hidden', () => {
    const html = render('electronics')
    expect(labels(html)).toContain('base_link') // a structural link
    expect(labels(html)).toContain('SG90_joint') // a joint
    const inert = rowClasses(html).filter((c) => c.includes('is-inactive'))
    expect(inert.length).toBeGreaterThan(0)
    // …and every dimmed row is a Build-only one, never a component.
    expect(inert.every((c) => c.includes('is-buildonly'))).toBe(true)
  })

  it('nothing is inert in Build — the same rows are all live there', () => {
    expect(rowClasses(render('build')).some((c) => c.includes('is-inactive'))).toBe(false)
    expect(rowClasses(render('build')).some((c) => c.includes('is-buildonly'))).toBe(true)
  })

  it('an inert row is really inert — its buttons are disabled', () => {
    const html = render('electronics')
    // The joint row's name button carries the disabled attribute.
    const jointRow = html.slice(html.indexOf('SG90_joint') - 900, html.indexOf('SG90_joint') + 60)
    expect(jointRow).toContain('disabled')
  })

  it('the components count is the board + parts, not every row', () => {
    // 1 MCU + 2 placed parts; base_link / bracket / joints are structure.
    expect(render('build')).toContain('>3</span>')
  })

  it('a row with no 3-D body has no live pencil — nothing to edit yet', () => {
    // The Display is placed in Electronics but has never been added to Build.
    const html = render('build')
    const at = html.indexOf('Edit Display')
    expect(at).toBeGreaterThan(-1)
    expect(html.slice(at - 220, at)).toContain('disabled')
  })

  it('the selection highlights the same key in either workspace', () => {
    for (const ws of ['electronics', 'build'] as const) {
      const html = render(ws, { selectedKey: 's1' })
      expect(html).toContain('aria-current="true"')
      expect(rowClasses(html).filter((c) => c.includes('is-selected'))).toHaveLength(1)
    }
  })
})

describe('HierarchyPanel — mass in the tooltip (#719)', () => {
  // The per-row BADGE was removed: a weight on every line is noise in a
  // structure view. The guarantee it protected is not — an unweighed body must
  // still never present a number it does not have, so the tooltip carries it.
  it('never invents a number — an unweighed body says so in its tooltip', () => {
    // `fixtureNodes()` carries an unweighed body (the OLED has no mass), so the
    // ordinary fixture is enough to prove the rule.
    const html = render('build')
    expect(html).toContain('mass unknown')
    expect(html).not.toContain('0 g')
  })
})
