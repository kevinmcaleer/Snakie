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

## Draw the board from a real image (always)

**Every board part must ship a real board image** — it's what makes the part look
like the actual hardware, and a board without one is not finished. Manufacturers'
product photos and the board render inside their **official pinout diagrams** are
fine to use here (vendors are happy to have their boards represented), so
**copyright is not a blocker — always include an image**.

**A. Background image (the life-like path — the default).** Get a **clean, top-down**
image — an official product photo (board flat, filling the frame, plain background)
**or the board render cropped out of the manufacturer's pinout diagram** (often the
cleanest source: already top-down, plain/transparent background, with the silk and
components drawn crisply). The silk text, the MCU, the connectors and the buttons
are all *in the image*, so you **don't draw any shapes** — you only overlay the
**pads** (positioned over the image's real pads) so the board is still wireable. See
**Background photo** below.

**B. Shapes + text (last resort only).** Only if **no** usable top-down image exists
anywhere, draw the board from `shapes` + `labels`:
- ✅ the **outline** at real dimensions, the **defining components** (a grey rect
  for the MCU/IC, the USB/JST/header connectors, a display glass), **mounting
  holes**, and the **pads** with their labels.
- ❌ **No copper traces or ground pours** (they make the board unreadable).
- ❌ Skip minutiae — not every SMD resistor/cap needs a shape.

## Background photo

1. **Source** a clean top-down image — a product-gallery photo on a plain
   background, or a top-down board render. Avoid angled/in-hand shots.
2. **Download** it (`curl -fsSL <url> -o raw.jpg`) and **look at it** (read the
   image) to confirm it's usable and to read the *real* layout.
3. **Crop to the board** so it fills the frame with little margin — e.g.
   `sips -c <h> <w> raw.jpg --out image.jpg` (centered). Read the crop to confirm.
4. **Remove the background** so the board sits on transparency. A plain backdrop
   otherwise shows as slivers wherever the PCB outline/**castellations** don't
   match a plain rectangle (the body clips to a rounded rect). If the image has
   **no alpha** (`sips -g hasAlpha image.jpg` → `no`), cut it out:
   - **Preferred (macOS, built-in, no install):** the Vision foreground mask via
     the bundled [`rmbg.swift`](rmbg.swift) recipe —
     `swiftc -O rmbg.swift -o rmbg && ./rmbg image.jpg image.png`. It uses
     `VNGenerateForegroundInstanceMaskRequest` → `generateMaskedImage(...)`, which
     keeps the **white silkscreen** (naive white-keying would erase it). Other good
     tools: `rembg`, remove.bg, Photoshop, Pixelmator Pro, Preview ▸ Remove Background.
   - **ASSESS the result before keeping it** (don't trust the cutout blindly): read
     it back and check `hasAlpha: yes`; the **corners are transparent** (backdrop
     gone) while the **centre stays opaque** (board kept); and the transparent
     fraction is sane (~15–70% — `0%` = nothing removed, `>90%` = subject eaten).
     Then *look* at the PNG to confirm silk + pads survived. (PIL one-liner over the
     alpha channel does corners-vs-centre + the fraction.)
   - **If the assessment fails** (subject eaten, halo/fringe, ragged castellations,
     or nothing removed) **do NOT ship it** — tell the user to redo it in a smarter
     tool and drop the cleaned PNG back in. A bad cutout looks worse than leaving
     the original. Then **downscale** to ≤512px longest edge and `optimize` the PNG
     (it's inlined as a data-URI on load).
5. **Place** `image.png` (transparent) in the part folder and reference it:
   ```yaml
   image: image.png
   imageLayer: { x: 0, y: 0, w: 1, h: 1 }   # fills the outline
   ```
   Set the part `aspect` (and `dimensions`) to the board's **real** aspect so the
   photo isn't stretched (it's drawn with `preserveAspectRatio: none`).
6. **Overlay the pads** over the photo's pads: read the cropped image and set each
   pin's `x`/`y` (0..1) to sit on its real pad. No `shapes`/`labels` needed.
   - For a board whose two edges are **symmetric** (same pad count, same pitch),
     give both edges the **same set of y-values** so pads line up **row-for-row**
     (mismatched counts/positions make the rows look skewed). Find the real pad
     centres from the photo instead of guessing — detect the **copper hue** along
     each edge strip (a castellated hole shows as two arcs; the pad centre is their
     midpoint), or overlay candidate y-lines and eyeball them against the holes.

```{note}
Manufacturer product photos and the board render from an official **pinout diagram**
are fine to use for a part image, in the Standard library included — vendors are
happy to have their boards represented, so there is **no copyright blocker** and no
need to swap the image before shipping. Prefer a clean official source and name the
vendor in the part's `manufacturer` field. (The pinout-diagram crop is usually the
best: it's already a top-down render on a plain background — see the XIAO RP2350 and
Tiny 2350 parts, both built this way.)
```

## ⚠️ Pin assignments are SAFETY-CRITICAL — verify, never guess

A wrong power/ground assignment will **destroy the user's hardware** (e.g. feeding
5V into a pad the user thinks is GND). Treat the pinout as something to *verify*,
not infer. Required:

1. **Find a real pinout DIAGRAM first — do not derive the pad list from the product
   photo.** Actively seek out a labelled pinout (a "Pins and Dims" / pinout image,
   the datasheet, or the vendor's forum/learn pages — e.g. search
   `"<board name> pinout"`; Pimoroni's live on their Discourse CDN). A diagram
   *enumerates every pad* with its GPIO/peripheral; a product photo does not —
   **corner and unlabelled `GND` pads are nearly invisible on a photo** and get
   dropped (exactly how the Tiny 2350 lost its 8th pad). Order of trust:
   datasheet / pinout diagram → sharp top-down silk → vendor docs.
2. **Reconcile the pad COUNT.** The board's spec states a pin count (e.g. Tiny 2350
   = *"16 pins (12 GPIO)"*). Count the pads you extracted **per edge and in total**
   and confirm they equal that number before going further. If they don't match,
   you've missed pads (usually GND) — go back to the diagram. Both edges of a
   symmetric board usually have the **same number of pads**.
3. **Number from a fixed origin** the board defines (e.g. pin 1 = the pad nearest
   the USB on the labelled edge) and walk the edge **in physical order**.
4. **Cross-check every power and ground pin by name** against the source — list
   each `5V` / `3V3` / `GND` (including the easily-missed extra GNDs) and confirm
   its position. Confirm which edge has power vs GPIO.
5. **Present the full pin table to the user for confirmation BEFORE finalising**
   — number, name, type, gpio — call out power/ground, and state the total pad
   count. The human holding the board is the final authority; don't ship
   assignments they haven't confirmed. If a source is missing/ambiguous, ask.
6. After any correction, **re-render** and re-show the table.

> Worked example of the failure mode: the Pimoroni Tiny 2350 (verified against its
> official Pins-and-Dims diagram) has **16 pads, 8 per edge**. Left edge (USB at
> top): **5V, GND, 3V3, A3(GP29), A2(GP28), A1(GP27), A0(GP26), GND**; right edge:
> **GP0–GP7**. Earlier passes (a) mis-ordered 5V/GND — which would short 5V to
> ground — and (b) dropped the 8th pad (the bottom-left GND), which is invisible on
> the photo, leaving 15 pads that didn't line up edge-to-edge. A pinout diagram +
> a count check (`8 + 8 = 16`) catches both.

## Steps

1. **Identify** the part: `name`, `manufacturer`, `partNumber`, real
   `dimensions` (width × height in **mm** — from the datasheet), and its
   **category** (set `family`; see categories below).
2. **Extract pins from an authoritative pinout** (see the safety section above):
   for each pin capture its `name` (silk), board `number` (and `gpio` for MCUs),
   electrical `type` (`io`/`pwr`/`gnd`/`other`), `capabilities`, and which **edge**
   it's on, in physical top→bottom order from a stated origin. Use `x`/`y` (0..1)
   for real positions; else spread evenly along the `edge`. **Cross-check every
   5V/3V3/GND** against the source. For **every capability a pad has** (not just
   I2C — do PWM and SPI too), record BOTH:
   - the **signal** under `signals` — I2C → `SDA`/`SCL`, SPI → `RX`/`CSn`/`SCK`/`TX`,
     UART → `TX`/`RX`, PWM → the `A`/`B` channel;
   - the **bus / channel number** under `buses` — the I2C/SPI/UART instance
     (`I2C0`, `SPI1`, `UART0` → `0`/`1`) and the ADC channel (`ADC2` → `2`).

   On a **microcontroller** these are **fixed by the chip**, not the board: read the
   MCU's bank0 **GPIO-function table** (its datasheet) and fill them for every GPIO
   — don't leave them blank. For **RP2040 / RP2350** the mapping is deterministic
   from the GPIO number `g`:
   `spi bus = 1 if g in 8..15 or 26..28 else 0`, `spi sig = [RX,CSn,SCK,TX][g%4]`;
   `i2c bus = 0 if g%4 in {0,1} else 1`, `i2c sig = SDA if g even else SCL`;
   `pwm chan = A if g even else B`; `adc = g-26` for GP26/27/28.
   Note the **GP## GPIO** even when the silk label differs (e.g. a pad silk-printed
   `SDA` that is really `GP4`) — set both `name: SDA` and `gpio: 4`.
3. **Draw the board — always with a real image.** Embed a cropped top-down board
   **image** (an official product photo, or the board render cropped from the
   manufacturer's pinout diagram — copyright is not a concern, see the note) and
   overlay the pads over it (see *Background photo*). Only as a **last resort**, when
   no usable image exists anywhere, lay out `shapes` (grey `rect` for chips/
   connectors) + `labels` + `mountingHoles` instead. A finished board part should
   not be image-less.
4. **Pick a category** for `family` so it lands in the right section (#193):
   `Microcontroller`, `Computer`, `Sensor`, `Input`, `Output`, `Motor`,
   `Display`, `Communication`, `Power`, `IC`.
5. **Version** with `version: 0.1.0` for a new part; when **regenerating/editing**
   an existing part, bump the PATCH (`0.1.0 → 0.1.1`) so the update check (#172/#194)
   sees the change.
6. **Write** the part folder: `parts.yml` (+ `image.jpg` if used) into a library
   (`my-parts/<id>/` for the user's library; a maintainer can later **promote** it
   to the Standard library, #192). For a part added to the bundled Standard
   library, also copy it into the running install's
   `<userData>/parts/snakie-standard/<id>/` (or restart) so it shows immediately.
7. **Verify**: it parses as YAML, pin `number`s are unique, coordinates are within
   0..1, `type`/`capabilities`/`shape` use the allowed values. Every edge pad has a
   `shape` **and** a per-edge `rotation` (so labels stay horizontal + castellations
   face out), and every `io` pad carries `signals` + `buses` for each of its
   capabilities. **Render it** (Board View / Part Editor, or a Playwright capture)
   to confirm the photo + pads line up **and no silk label is rotated up/down**.
8. **Confirm with the user**: present the **full pin table** (number · name · type ·
   gpio), highlighting **power/ground**, and get the user (who has the board) to
   confirm before the part is considered done — see the safety section.

## Pad shape & castellation rotation

Set every pad's `shape` explicitly — `castellated` for the plated half-holes on a
castellated board, `header` for a through-hole ring, `square`/`round` for SMD.
**Also set `rotation` on every edge pin** so the pad *and its silk label* face the
right way. `rotation` is the outward direction — **0 = right, 90 = down,
180 = left, 270 = up** — so use the pin's **edge**:

| edge | `rotation` |
|------|-----------|
| left | `180` |
| right | `0` |
| top | `270` |
| bottom | `90` |

Why it matters (this is a real bug, not cosmetic): when `rotation` is omitted the
renderer guesses the outward direction from each pad's *nearest board border*. For
the **top-most and bottom-most pin in a left/right column** the nearest border is
the top/bottom edge, so those labels get turned 90° (pointing up/down) while the
rest stay horizontal — the classic "some labels point up and down" report. Setting
`rotation` per edge pins the whole column to one direction: castellations face
outward and **every label stays horizontal**. Set it on power/ground pads too, not
just the GPIOs. (Applies to `left`/`right`/`top`/`bottom` edge headers alike.)

## Onboard LEDs, RGB & NeoPixels

Many boards carry an onboard indicator tied to GPIO(s) — capture these under
`onboardLeds` so the board reproduces accurately. Each has a `kind` and a
normalised `x`/`y` position:
- **`single`** — one LED on one GPIO (e.g. the Pico's onboard LED on **GP25**):
  `{ kind: single, gpio: 25, x: …, y: … }` (optional `color`).
- **`rgb`** — an analog RGB LED with three GPIO channels (e.g. the Tiny 2350's
  **GP18/19/20**): `{ kind: rgb, rgb: { r: 18, g: 19, b: 20 }, x: …, y: … }`.
- **`neopixel`** — an addressable WS2812/SK6812 driven over a single **data** GPIO;
  some boards add a **power-enable** GPIO (optional — most NeoPixels need only the
  data line). E.g. the Seeed XIAO RP2350's DATA **GP22** + POWER **GP23**:
  `{ kind: neopixel, gpio: 22, power: 23, x: …, y: … }`.

## Connectors (QWIIC / STEMMA QT / JST)

**Whenever the board exposes a QWIIC / STEMMA QT / JST socket, add it under
`connectors`** — a real socket, *not* a drawn `shapes` rectangle. The editor draws
the housing **to real-world scale from the part's mm `dimensions`** (a QWIIC ≈
4.5 mm, a 2 mm-pitch JST is wider), so give the part accurate `dimensions` and place
the connector at its true `x`/`y` for a life-like result. Each connector has a
`kind`, a normalised `x`/`y`, an optional `label`, and `pins` that are **full pins**
(same fields as header pins, so they're wireable):
- **`qwiic`** — a 4-pin JST-SH **1.0 mm-pitch** I2C socket (STEMMA QT is identical),
  in the standard order **GND · 3V3 · SDA · SCL**. Give SDA/SCL their `gpio`,
  `capabilities: [i2c]`, `signals: { i2c: SDA|SCL }` and the `buses: { i2c: N }`;
  3V3 is `pwr`, GND is `gnd`.
- **`jst`** — a generic **2.0 mm-pitch** JST (PH) header; author its pins as needed
  (name, type, and `gpio`/`capabilities`/`signals`/`buses` for any signal pins).

```yaml
connectors:
  - kind: qwiic
    label: QWIIC
    x: 0.5
    y: 0.9
    pins:
      - { name: GND, type: gnd }
      - { name: '3V3', type: pwr }
      - { name: SDA, type: io, gpio: 4, capabilities: [i2c], signals: { i2c: SDA }, buses: { i2c: 0 } }
      - { name: SCL, type: io, gpio: 5, capabilities: [i2c], signals: { i2c: SCL }, buses: { i2c: 0 } }
```

## `parts.yml` shape (the fields you'll write)

Pins use `name` (the silk name), not `label`.

```yaml
id: vl53l0x                 # kebab-case, unique within the library
name: VL53L0X ToF
manufacturer: STMicroelectronics
partNumber: VL53L0X
family: Sensor              # the category (see step 4)
description: Time-of-flight distance sensor breakout
version: 0.1.0
dimensions: { width: 21, height: 13 }   # mm; sets the real footprint + aspect
aspect: 1.6                 # width/height — match the board so a photo isn't stretched
pinSpacing: 2.54            # mm between header pins (default 2.54)
pcbColor: '#0f5a2e'
# Life-like background photo (preferred). With this, omit `shapes`/`labels` — the
# silk + components are in the photo — and just position the pads over it.
image: image.jpg
imageLayer: { x: 0, y: 0, w: 1, h: 1 }
headers:
  - edge: left             # left | right | top | bottom
    pins:
      # every edge pad: shape + per-edge rotation (left → 180) so labels stay level:
      - { number: 1, name: VIN, type: pwr, x: 0.08, y: 0.20, shape: castellated, rotation: 180 }
      - { number: 2, name: GND, type: gnd, x: 0.08, y: 0.40, shape: castellated, rotation: 180 }
      # a multi-function MCU GPIO: fill signals + buses for EACH capability:
      - { number: 3, name: GP2, type: io, gpio: 2, capabilities: [digital, pwm, i2c, spi], signals: { pwm: A, i2c: SDA, spi: SCK }, buses: { i2c: 1, spi: 0 }, x: 0.08, y: 0.60, shape: castellated, rotation: 180 }
      - { number: 4, name: SCL, type: io, gpio: 5, capabilities: [i2c], signals: { i2c: SCL }, buses: { i2c: 0 }, x: 0.08, y: 0.80, shape: castellated, rotation: 180 }
# Onboard indicators tied to GPIO(s): single LED / analog RGB / addressable NeoPixel.
onboardLeds:
  - { kind: single, gpio: 25, x: 0.5, y: 0.15 }             # e.g. Pico LED
  - { kind: rgb, rgb: { r: 18, g: 19, b: 20 }, x: 0.5, y: 0.5 }   # e.g. Tiny 2350
  - { kind: neopixel, gpio: 22, power: 23, x: 0.7, y: 0.5 } # e.g. XIAO RP2350 (power optional)
# Only when there is NO photo, draw the board instead:
# shapes:
#   - { kind: rect, x: 0.35, y: 0.30, w: 0.3, h: 0.4, fill: '#1c2227', label: VL53L0X }
# labels:
#   - { text: ToF, x: 0.5, y: 0.9, fontSize: 10 }
```

Allowed values:
- pin `type`: `io` · `pwr` · `gnd` · `other`
- pin `capabilities`: `digital` · `pwm` · `adc` · `i2c` · `spi` · `uart`
- pin `signals` (per capability): `i2c: SDA|SCL` · `spi: RX|CSn|SCK|TX` ·
  `uart: TX|RX` · `pwm: A|B`
- pin `buses` (per capability, a number): `i2c` · `spi` · `uart` bus id · `adc` channel
- pad `shape`: `round` · `square` · `castellated` · `header`
- `onboardLeds[].kind`: `single` (uses `gpio`) · `rgb` (uses `rgb.r/g/b`) ·
  `neopixel` (uses `gpio` data + optional `power`)
- `connectors[].kind`: `qwiic` (4-pin JST-SH I2C: GND/3V3/SDA/SCL) · `jst`
  (generic); `connectors[].pins` are full pins (same fields as header pins)
- shape `kind`: `rect` · `circle` · `polygon`
- For an **MCU board** (so it appears in the Board View's board picker) set
  `family: Microcontroller` and give each GPIO pin its `gpio` number.

## References

- The schema + behaviour: `docs/parts-library.md`, `docs/part-editor.md`,
  `src/shared/part.ts`, and the snakie.org docs `reference/parts-yml`.
- The target part wishlist to work through: [`docs/common-parts.md`](../../../docs/common-parts.md) (#199).
- After authoring, a maintainer promotes the part into the **Standard library**
  and **Publishes** it (developer mode) so users get it via the update check.
