# Part Editor — the single layer hierarchy

Status: **model, tree and per-row hide/lock done. Structural merge of the panel
into one list, and canvas enforcement, outstanding.**

## Why

The Part Editor grew separate layers: a *Parts* list (shapes, labels, buttons,
LEDs, connectors), a *Pins* list, and *Mounting holes* — each with its own
visibility toggle, none of which could be mixed. Authoring the XIAO Expansion
Base made the cost obvious: a Grove connector and the contacts that belong to it
live in different lists, so they can't be grouped, can't be moved together, and
can't be hidden together.

The goal is **one hierarchy** holding every item the editor can select, where a
group may mix kinds, and where any item *or* group can be hidden and locked
individually.

## Shape of the tree

```
▾ Grove I2C          (group — mixes kinds)
    GROVE I2C        (connector)
    SCL  SDA         (pins)
▾ servo-1            (group, synthesised from the pins' `group` id)
    S  V  G          (pins)
▾ Components         (bucket — ungrouped shapes/labels/buttons/LEDs/connectors)
▾ Pins               (bucket — ungrouped pins)
▾ Mounting holes     (bucket)
```

**Groups go top-level; ungrouped items go in a kind bucket.** The rule is
positional rather than smart, so where a row lands is always predictable.

Buckets exist for density: the servo2040 is 78 pads, and without them the three
interesting rows drown. With them — and with its 18 servo headers read as groups
— it's 18 group rows plus 24 loose pins.

An empty bucket is omitted. An empty **group** is kept: that's a group the user
is part-way through filling.

## Model (`src/shared/part.ts`)

Every item kind — `pin`, `hole`, `button`, `led`, `shape`, `label`, `connector`
— carries `group`, `hidden`, `locked`, `z`. `PartGroup` carries its own
`hidden`/`locked`.

- `groupChain(groups, id)` — ancestry, innermost first. Tolerates a dangling
  `parent`; terminates on a cycle (only a hand-edited `parts.yml` makes one, but
  it would otherwise freeze the editor on every repaint).
- `itemHidden(groups, item)` / `itemLocked(groups, item)` — **effective** state.

Hiding a group does **not** write to its members' flags, so un-hiding restores
exactly what was showing before rather than revealing everything. That's why
every tree node exposes both the effective state and its own flag.

> **Whitelist trap.** `parts.yml` (`part-yaml.ts`) and `normalisePart`
> (`part-editor.util.ts`) both rebuild items field-by-field. Every kind routes
> through one shared flag copier — `readItemFlags`/`writeItemFlags` and
> `keepItemFlags`. Add a flag there, not in seven places. `test/partYaml.test.ts`
> round-trips **all seven kinds**, which is what caught `normalisePart` silently
> dropping every flag while the types compiled fine.

## Tree (`partLayerTree` in `part-editor.util.ts`)

Returns `LayerNode[]`. Each node carries `hidden`/`locked` (effective) **and**
`ownHidden`/`ownLocked` (the row's own flag — what its toggle writes).

Two cases worth keeping:

- **Synthesised groups.** A group id referenced by items but absent from the
  `groups` registry still becomes a row. The servo2040 is authored exactly that
  way (`group: servo-1` on the pins, no registry); without this its headers
  scatter into the pin bucket.
- **Orphan parents.** A group whose `parent` doesn't exist is treated as
  top-level rather than dropped, which would take its contents out of the tree.

Tests: `test/partLayerTree.test.ts`, including an assertion against the real
`servo2040/parts.yml` so the 18-groups-not-78-rows property can't regress.

## Outstanding

### 1. Merge the panel into ONE list (`PartEditor.tsx`, `LayersPanel`)

Per-row eye + lock are **done** — every row (component, grouped component, pin,
servo-header group, mounting hole) carries them, driven by `partLayerTree` for
effective state and `withItemFlag`/`withGroupFlag` for the write. What remains is
structural: the *Parts* and *Pins* sections are still separate lists rather than
one tree from `partLayerTree`.

That was left deliberately. Those sections carry a lot of behaviour worth keeping
— pin column sorting, servo-trio collapsing, drag-reorder, group rename — and
re-implementing it from scratch risks losing it. The merge should MOVE those row
renderers under the bucket nodes, not rewrite them.

Replace the current *Parts* + *Pins* sections with one tree from
`partLayerTree`. Today `LayersPanel` has two variants (`'layers'` = Parts+Pins,
`'board'` = holes/PCB/image); the board-level rows (PCB, Background image) are
**not** items and should stay as they are.

Must keep, per the user: the **`+ Header`** button and the **sort-headers**
control, now belonging to the Pins bucket.

Each row (group, bucket, item) gets an eye and a lock. Toggling writes the
row's **own** flag. A row whose effective state differs from its own (because an
ancestor group is hidden/locked) should read as inherited rather than looking
toggled.

`lock` is currently renderer-only `useState<LayerLocks>` keyed by layer — that
whole mechanism is superseded and should go, along with `DEFAULT_LOCKS`.

Keep `part.layerVisibility` working: it's in every shipped `parts.yml`, and
`pcb`/`image` still need it. Treat it as a coarse master above the per-item flags.

### 2. Canvas enforcement (`part-body.tsx`, `PartEditor.tsx`)

- `PartBody` skips items where `itemHidden(...)` is true.
- Selection, drag, restyle and delete refuse items where `itemLocked(...)` is true.
- Group ops (align/distribute/move/rotate/delete) already treat a group as one
  rigid unit by group root — that must now extend to pins and holes joining
  mixed-kind groups.

## Related, already shipped

Connector kinds (`grove`, `dupont`) with contact order as orientation; cables
with real conductor colours, seated plugs and keyed snapping; board stacking
(`footprint` / `mounts`) with same-name pin bonding. See `CHANGELOG.md`
`[Unreleased]`.
