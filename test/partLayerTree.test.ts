import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { partFromYaml } from '../src/shared/part-yaml'
import {
  normalisePart,
  partLayerTree,
  withBucketFlag,
  withGroupFlag,
  withItemFlag,
  type HierItem,
  type LayerNode
} from '../src/renderer/src/components/part-editor.util'
import type { PartDefinition } from '../src/shared/part'

/**
 * The Part Editor's single layer hierarchy: groups at the top (mixing kinds),
 * ungrouped items bucketed by kind so a dense board stays navigable.
 */
const ids = (nodes: LayerNode[]): string[] => nodes.map((n) => n.id)
const find = (nodes: LayerNode[], id: string): LayerNode | undefined => {
  for (const n of nodes) {
    if (n.id === id) return n
    const hit = find(n.children, id)
    if (hit) return hit
  }
  return undefined
}

describe('partLayerTree', () => {
  it('puts a mixed-kind group at the top and buckets what is left', () => {
    const part = normalisePart({
      id: 'p',
      name: 'P',
      groups: [{ id: 'g', name: 'Grove I2C' }],
      // A connector and its contacts in ONE group — the thing the old model
      // could not express, because connectors had no `group` at all.
      connectors: [{ kind: 'grove', variant: 'i2c', x: 0.5, y: 0.9, group: 'g', pins: [{ name: 'SCL', type: 'io' }] }],
      headers: [
        {
          edge: 'left',
          pins: [
            { name: 'SCL', type: 'io', group: 'g' },
            { name: 'SDA', type: 'io', group: 'g' },
            { name: 'D0', type: 'io' }
          ]
        }
      ],
      mountingHoles: [{ x: 0.1, y: 0.1, diameter: 2 }],
      labels: [{ text: 'U1', x: 0.5, y: 0.5 }]
    })
    const tree = partLayerTree(part)
    expect(ids(tree)).toEqual(['group:g', 'bucket:components', 'bucket:pins', 'bucket:holes'])

    const g = find(tree, 'group:g')!
    expect(g.label).toBe('Grove I2C')
    // One connector + two pins, kinds mixed inside the one group.
    expect(g.children.map((c) => c.item?.kind).sort()).toEqual(['connector', 'pin', 'pin'])
    // ...and they are NOT also in the buckets.
    expect(find(tree, 'bucket:pins')!.children.map((c) => c.label)).toEqual(['D0'])
    expect(find(tree, 'bucket:components')!.children.map((c) => c.label)).toEqual(['U1'])
    expect(find(tree, 'bucket:holes')!.children).toHaveLength(1)
  })

  it('omits a bucket with nothing in it', () => {
    const part = normalisePart({
      id: 'p',
      name: 'P',
      headers: [{ edge: 'left', pins: [{ name: 'A', type: 'io' }] }]
    })
    expect(ids(partLayerTree(part))).toEqual(['bucket:pins'])
  })

  it('nests a child group inside its parent', () => {
    const part = normalisePart({
      id: 'p',
      name: 'P',
      groups: [
        { id: 'outer', name: 'Outer' },
        { id: 'inner', name: 'Inner', parent: 'outer' }
      ],
      headers: [
        {
          edge: 'left',
          pins: [
            { name: 'A', type: 'io', group: 'outer' },
            { name: 'B', type: 'io', group: 'inner' }
          ]
        }
      ]
    })
    const tree = partLayerTree(part)
    expect(ids(tree)).toEqual(['group:outer'])
    const outer = tree[0]
    expect(ids(outer.children)).toEqual(['group:inner', 'pin:0'])
    expect(ids(outer.children[0].children)).toEqual(['pin:1'])
  })

  it('resolves hidden/locked down the tree, keeping each row’s OWN flag intact', () => {
    const part = normalisePart({
      id: 'p',
      name: 'P',
      groups: [{ id: 'g', name: 'G', hidden: true }],
      headers: [{ edge: 'left', pins: [{ name: 'A', type: 'io', group: 'g', locked: true }] }]
    })
    const pin = find(partLayerTree(part), 'pin:0')!
    // Effective: hidden by the group, locked by itself.
    expect([pin.hidden, pin.locked]).toEqual([true, true])
    // Own flags: the group's hiding did NOT write to the pin, so un-hiding the
    // group brings the pin back exactly as it was.
    expect([pin.ownHidden, pin.ownLocked]).toEqual([false, true])
  })

  it('keeps a group whose parent does not exist rather than losing its contents', () => {
    // Only reachable from a hand-edited parts.yml, but silently dropping a group
    // would take every item inside it out of the tree too.
    const part: PartDefinition = {
      id: 'p',
      name: 'P',
      groups: [{ id: 'orphan', name: 'Orphan', parent: 'gone' }],
      headers: [{ edge: 'left', pins: [{ name: 'A', type: 'io', group: 'orphan' }] }]
    }
    const tree = partLayerTree(part)
    expect(ids(tree)).toEqual(['group:orphan'])
    expect(ids(tree[0].children)).toEqual(['pin:0'])
  })

  it('reads a real dense board as its header groups, not a wall of pins', () => {
    // The servo2040 is 78 pads. Grouped as 18 servo headers, the tree is short.
    const yaml = readFileSync(
      join(__dirname, '..', 'examples', 'parts', 'snakie-standard', 'servo2040', 'parts.yml'),
      'utf-8'
    )
    const part = normalisePart(partFromYaml(yaml))
    const tree = partLayerTree(part)
    const groups = tree.filter((n) => n.kind === 'group')
    expect(groups).toHaveLength(18)
    // Each servo header is its Signal/V+/GND trio.
    for (const g of groups) expect(g.children).toHaveLength(3)
    // 78 pads - 54 in headers = 24 loose pins, so the bucket stays readable.
    const pins = tree.find((n) => n.id === 'bucket:pins')
    expect(pins!.children.length).toBe(78 - 18 * 3)
    // Top level is 18 groups + whatever buckets are non-empty — not 78 rows.
    expect(tree.length).toBeLessThan(25)
  })
})

describe('hide / lock mutations', () => {
  const base = (): PartDefinition =>
    normalisePart({
      id: 'p',
      name: 'P',
      groups: [{ id: 'g', name: 'G' }],
      headers: [
        {
          edge: 'left',
          pins: [
            { name: 'A', type: 'io', group: 'g' },
            { name: 'B', type: 'io' }
          ]
        }
      ],
      connectors: [{ kind: 'grove', variant: 'i2c', x: 0.5, y: 0.9, group: 'g', pins: [{ name: 'SCL', type: 'io' }] }],
      mountingHoles: [{ x: 0.1, y: 0.1, diameter: 2 }],
      labels: [{ text: 'U1', x: 0.5, y: 0.5 }]
    })

  it('hides one item without touching its siblings or its group', () => {
    const part = base()
    const next = normalisePart({ ...part, ...withItemFlag(part, { kind: 'pin', index: 1 }, 'hidden', true) })
    expect(next.headers[0].pins[1].hidden).toBe(true)
    expect(next.headers[0].pins[0].hidden).toBeUndefined()
    expect(next.groups?.[0].hidden).toBeUndefined()
  })

  it('reaches every kind, including the ones that had no group before', () => {
    const part = base()
    const kinds: [HierItem, (p: PartDefinition) => unknown][] = [
      [{ kind: 'connector', index: 0 }, (p) => p.connectors?.[0].locked],
      [{ kind: 'hole', index: 0 }, (p) => p.mountingHoles?.[0].locked],
      [{ kind: 'label', index: 0 }, (p) => p.labels?.[0].locked],
      [{ kind: 'pin', index: 0 }, (p) => p.headers[0].pins[0].locked]
    ]
    for (const [item, read] of kinds) {
      const next = normalisePart({ ...part, ...withItemFlag(part, item, 'locked', true) })
      expect(read(next)).toBe(true)
    }
  })

  it('clearing a flag removes it rather than writing false', () => {
    // `hidden: false` would survive the round-trip as noise in every parts.yml.
    const part = normalisePart({ ...base(), ...withItemFlag(base(), { kind: 'pin', index: 1 }, 'hidden', true) })
    const off = normalisePart({ ...part, ...withItemFlag(part, { kind: 'pin', index: 1 }, 'hidden', false) })
    expect('hidden' in off.headers[0].pins[1]).toBe(false)
  })

  it('hiding a group hides its members’ EFFECTIVE state, not their own flags', () => {
    const part = base()
    const next = normalisePart({ ...part, ...withGroupFlag(part, 'g', 'hidden', true) })
    const pin = find(partLayerTree(next), 'pin:0')!
    expect([pin.hidden, pin.ownHidden]).toEqual([true, false])
    // ...and un-hiding restores exactly what was showing before.
    const back = normalisePart({ ...next, ...withGroupFlag(next, 'g', 'hidden', false) })
    expect(find(partLayerTree(back), 'pin:0')!.hidden).toBe(false)
  })

  it('registers a synthesised group when one of its flags is set', () => {
    // The servo2040 has `group: servo-1` on pins and no registry at all; without
    // registering it here the toggle would have nowhere to write.
    const part = normalisePart({
      id: 'p',
      name: 'P',
      headers: [{ edge: 'left', pins: [{ name: 'S', type: 'io', group: 'servo-1' }] }]
    })
    expect(part.groups).toBeUndefined()
    const next = normalisePart({ ...part, ...withGroupFlag(part, 'servo-1', 'locked', true) })
    expect(next.groups).toEqual([{ id: 'servo-1', locked: true }])
    expect(find(partLayerTree(next), 'pin:0')!.locked).toBe(true)
  })

  it('a bucket toggle fans out to every item in it', () => {
    const part = base()
    const pins = partLayerTree(part).find((n) => n.id === 'bucket:pins')!
    const next = normalisePart({ ...part, ...withBucketFlag(part, pins, 'hidden', true) })
    // Only the UNGROUPED pin is in that bucket, so only it is hidden.
    expect(next.headers[0].pins[1].hidden).toBe(true)
    expect(next.headers[0].pins[0].hidden).toBeUndefined()
  })
})
