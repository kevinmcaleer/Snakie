# Part Editor — the single layer hierarchy

Status: **done.** Model, tree, per-row hide/lock, canvas enforcement and the
merge into one list have all landed.

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

### 1. The panel — DONE

`LayersPanel` renders ONE list from `partLayerTree`: groups first, then the three
buckets. The old *Parts* and *Pins* sections, their per-layer eye/lock, and the
duplicate *Mounting holes* section under the inspector are gone.

The row renderers were RELOCATED, not rewritten, so what they carried survives:
pin number/GPIO/type columns and their sorting, group rename on double-click,
ungroup, and drag-reorder of the component stack (still offered only when no
group exists, exactly as before — reordering a subset of the z-stack while groups
nest isn't well defined).

Two things the panel does that the tree deliberately doesn't:

- It shows **all three buckets even when empty**. `partLayerTree` omits an empty
  bucket, which is right for a general tree and wrong for the panel — the empty
  bucket is exactly where you go to create the first pin or hole.
- Bucket rows get an add chip (`＋ Add` menu / `＋` pin / servo header / `＋`
  hole) and a `−` delete enabled when the selection belongs to that bucket. Row
  -level trash stays on component rows only; on 78 pins it would be noise.

### 2. Canvas enforcement — DONE

Enforced in **`PartCanvas`**, the editor's own renderer, NOT in `PartBody`.
That split matters: `PartBody` draws the part for the Board View, the mini board
and the wiring canvas, so enforcing there would let an author hide part of a
SHIPPED part for everyone. `hidden` is an authoring aid; consumer views still
draw the part in full. Flipping that is a one-line change if it's ever wanted.

- `shown()` gates rendering — pins, holes (including the drilled hole in the PCB
  mask), and every component kind through the unified `orderedItems` render.
- `pickable()` gates `hitTest`, so a click falls THROUGH a hidden or locked item
  to whatever is underneath rather than selecting something invisible or immovable.
- `onDeleteSelected` refuses a locked item or one inside a locked group. Locking
  is worth little if Delete still removes what you froze.

Still open: group ops (align/distribute/move/rotate) treat a group as one rigid
unit by group root — that wants extending to pins and holes now that they can
join mixed-kind groups.

## Related, already shipped

Connector kinds (`grove`, `dupont`) with contact order as orientation; cables
with real conductor colours, seated plugs and keyed snapping; board stacking
(`footprint` / `mounts`) with same-name pin bonding. See `CHANGELOG.md`
`[Unreleased]`.
