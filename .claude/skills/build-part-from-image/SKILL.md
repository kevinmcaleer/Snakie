---
name: build-part-from-image
description: >-
  Build a Snakie part (parts.yml) from a product page or part image + pinout.
  Use when the user points at a product/datasheet page or a photo/pinout diagram
  of an electronic part (sensor, board, driver, IC, display, …) and wants it
  turned into a Snakie Parts Library part — extracting pins from the pinout and
  drawing the key components with the Part Editor's shapes & text tools. Part of
  epic #191 (Standard library updates).
---

# Build a Snakie part from an image

Turn a product page / part image (with a pinout) into a valid Snakie part folder
(`parts.yml` + optional `image`). Aim for a part that looks right in the Part
Editor and the Board View and whose pins resolve correctly — **not** a
pixel-faithful PCB.

## Inputs

One or more of:
- a **product / datasheet URL** (use WebFetch to read it),
- a **part image** (read it to see the silkscreen, connectors, mounting holes),
- a **pinout** (a labelled diagram, or a text pin table).

If a pinout diagram is available, prefer it for pin positions; otherwise use the
text pin description and lay pins out evenly along the edges.

## What to include — and what to leave out

Represent only the features that help a user recognise and wire the part:
- ✅ the **outline** at real dimensions, the **pins/pads** (position + label +
  type), the **defining components** (the MCU/IC body, USB/JST/header connectors,
  a display glass, big capacitors/regulators if iconic), and **mounting holes**.
- ❌ **No copper traces or ground pours** (they make the board unreadable).
- ❌ Skip minutiae — not every SMD resistor/cap needs a shape. A few grey
  rectangles + labels convey the part; favour clarity over fidelity.

Use the part image as a clipped background **only if** it's a clean top-down shot;
otherwise draw the part from shapes + text (a grey rectangle for an MCU/IC is the
canonical representation).

## Steps

1. **Identify** the part: `name`, `manufacturer`, `partNumber`, real
   `dimensions` (width × height in **mm** — from the datasheet), and its
   **category** (set `family`; see categories below).
2. **Extract pins** from the pinout: for each pin capture its `label` (silk
   name), board `number` (and `gpio` for MCUs), electrical `type`
   (`io`/`pwr`/`gnd`/`other`), `capabilities`, and which **edge** it's on. Use
   `x`/`y` (0..1, fraction of the outline) for real positions when the pinout
   shows them; else spread pins evenly along their `edge`.
3. **Lay out components** as `shapes` (grey `rect` for chips/connectors, etc.) +
   `labels` (silk text), and add `mountingHoles`.
4. **Pick a category** for `family` so it lands in the right section (#193):
   `Microcontroller`, `Computer`, `Sensor`, `Input`, `Output`, `Motor`,
   `Display`, `Communication`, `Power`, `IC`.
5. **Write** `parts.yml` into a library folder (`my-parts/<id>/parts.yml` for the
   user's library; a maintainer can later **promote** it to the Standard library).
6. **Verify**: it parses as YAML, pin `number`s are unique, coordinates are within
   0..1, and `type`/`capabilities`/`shape` use the allowed values below. Tell the
   user to open it in the **Part Editor** to eyeball + tweak.

## `parts.yml` shape (the fields you'll write)

```yaml
id: vl53l0x                 # kebab-case, unique within the library
name: VL53L0X ToF
manufacturer: STMicroelectronics
partNumber: VL53L0X
family: Sensor              # the category (see step 4)
description: Time-of-flight distance sensor breakout
dimensions: { width: 21, height: 13 }   # mm; sets the real footprint + aspect
pinSpacing: 2.54            # mm between header pins (default 2.54)
pcbColor: '#0f5a2e'
headers:
  - edge: left             # left | right | top | bottom
    pins:
      - { number: 1, label: VIN, type: pwr, x: 0.08, y: 0.20 }
      - { number: 2, label: GND, type: gnd, x: 0.08, y: 0.40 }
      - { number: 3, label: SDA, type: io,  capabilities: [i2c], x: 0.08, y: 0.60, shape: castellated }
      - { number: 4, label: SCL, type: io,  capabilities: [i2c], x: 0.08, y: 0.80, shape: castellated }
mountingHoles:
  - { x: 0.92, y: 0.18, diameter: 2.5 }
shapes:
  - { kind: rect, x: 0.35, y: 0.30, w: 0.3, h: 0.4, fill: '#1c2227', label: VL53L0X }
labels:
  - { text: ToF, x: 0.5, y: 0.9, fontSize: 10 }
```

Allowed values:
- pin `type`: `io` · `pwr` · `gnd` · `other`
- pin `capabilities`: `digital` · `pwm` · `adc` · `i2c` · `spi` · `uart`
- pad `shape`: `round` · `square` · `castellated` · `header`
- shape `kind`: `rect` · `circle` · `polygon`
- For an **MCU board** (so it appears in the Board View's board picker) set
  `family: Microcontroller` and give each GPIO pin its `gpio` number.

## References

- The schema + behaviour: `docs/parts-library.md`, `docs/part-editor.md`,
  `src/shared/part.ts`, and the snakie.org docs `reference/parts-yml`.
- The target part wishlist to work through: [`docs/common-parts.md`](../../../docs/common-parts.md) (#199).
- After authoring, a maintainer promotes the part into the **Standard library**
  and **Publishes** it (developer mode) so users get it via the update check.
