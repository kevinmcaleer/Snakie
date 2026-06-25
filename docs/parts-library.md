# Parts Library — portable, community-authored parts (#129)

The **Parts Library** makes hardware parts (microcontroller boards, sensor
breakouts, motor drivers, …) **portable and community-authored** instead of
hard-coded into Snakie. It's modelled on **Fusion 360's electronics libraries**:
you can have any number of **libraries**, each holding many **parts**, and a
master list of approved community libraries lives in a GitHub repo — so adding
new parts is just **PRs against that repo**.

Open it from the **Parts** icon in the activity bar (the IC chip). From there you
can browse installed libraries, search across every part, inspect a part's
footprint + pinout, author new parts (see [part-editor.md](part-editor.md)), and
install / update community libraries.

## Where the files go

```
<userData>/parts/
  <libraryId>/
    library.yml              # the library manifest
    <partId>/
      parts.yml              # the part definition (human-readable YAML)
      image.png|jpg|svg      # optional board image asset
```

`<userData>` is the per-user app-data directory Electron picks for Snakie
(`~/Library/Application Support/Snakie/` on macOS, `%APPDATA%/Snakie/` on
Windows, `~/.config/Snakie/` on Linux). The fastest way to find it: click the
**📁** button in the Parts view — it creates the folder if needed and reveals it.

Each **part lives in its own folder** (the epic's requirement), so a part is
self-contained and portable: copy the folder to move the part, or commit it to a
library repo to share it. The image is stored as a **separate asset file** (kept
out of the YAML so the file stays small and diff-friendly); Snakie inlines it for
rendering when it reads the part.

Anything malformed is skipped — a typo in one `parts.yml` won't stop the rest of
the library loading.

## The library manifest — `library.yml`

```yaml
id: pimoroni              # unique; the library folder name
name: Pimoroni Parts      # shown in the panel
description: Boards & breakouts from Pimoroni
author: Pimoroni
homepage: https://github.com/pimoroni/snakie-parts
version: 2.0.0            # SemVer; drives update detection vs the registry
```

Only `id` + `name` are required. A folder of parts with **no** `library.yml`
still loads (Snakie synthesises a manifest from the folder name).

## A part — `parts.yml`

Every field except `id`, `name` and at least one `headers` entry is optional. The
header block (top) is the catalogue metadata the epic spells out; below it is the
geometry the [Board Viewer](board.md) needs to draw an accurate footprint.

```yaml
id: vl53l0x
name: VL53L0X ToF
description: Time-of-flight distance sensor
manufacturer: STMicroelectronics
family: Sensor
tags: [i2c, distance, tof]
package: SMD               # THT | SMD
pinSpacing: 2.54           # header pitch, millimetres
voltage: 2.8–5V
partNumber: VL53L0X
properties:                # arbitrary user-defined key/value spec rows
  range: 2m
  interface: I²C
version: 1.0.0             # SemVer of THIS part

# --- geometry / rendering ---
mcu: ''                    # MCU sub-label, when the part is a board
pcbColor: '#101820'        # PCB fill (any CSS colour)
aspect: 1.3                # outline width / height
dimensions: { width: 25, height: 11 }   # physical size in millimetres
polygon:                   # OPTIONAL physical board outline (normalised 0..1)
  - { x: 0, y: 0 }
  - { x: 1, y: 0 }
  - { x: 1, y: 1 }
  - { x: 0, y: 1 }

# --- pins, holes, buttons ---
headers:                   # rows of pins along an edge (vertical = left/right)
  - edge: bottom
    pins:
      - { name: VIN, type: pwr, number: 1 }
      - { name: GND, type: gnd, number: 2 }
      - { name: SCL, type: io,  number: 3, gpio: 5, capabilities: [i2c, digital] }
      - { name: SDA, type: io,  number: 4, gpio: 4, capabilities: [i2c, digital], castellated: true }
mountingHoles:
  - { x: 0.1, y: 0.5, diameter: 2 }       # normalised pos + mm diameter
buttons:
  - { label: XSHUT, x: 0.8, y: 0.5 }      # normalised position
ledLabel: LED              # onboard-LED pin token (name/gpio)

# --- assets ---
image: image.png           # relative filename of the board image asset
```

### Pin fields

| Field          | Meaning                                                            |
| -------------- | ----------------------------------------------------------------- |
| `name`         | GPIO / signal name (`GP0`, `SDA`, `VBUS`). **Required.**          |
| `type`         | `pwr` · `gnd` · `io` · `other` (electrical role).                 |
| `number`       | Physical board pin number (silk numbering), if printed.           |
| `gpio`         | GPIO number — matched against `Pin(n)` when rendered. `io` only.  |
| `capabilities` | For `io`: any of `digital`, `pwm`, `adc`, `spi`, `i2c`.           |
| `castellated`  | `true` for a castellated edge pad (vs a regular header hole).     |
| `label`        | Optional alternate silk text when it differs from `name`.         |

`gpio` and `capabilities` are only meaningful on `io` pins (Snakie drops them
from power/ground pins on load).

### Polygon, holes, buttons

- **`polygon`** — the physical board shape as normalised `0..1` points (≥ 3).
  Omit it for a plain rounded rectangle of `aspect`.
- **`mountingHoles`** — each is a normalised `x`/`y` plus a `diameter` in mm.
- **`buttons`** — a `label` at a normalised `x`/`y`.

## The community registry

The master list of approved libraries is a JSON document in a GitHub repo. Adding
a library is a **PR against that repo**. The default index is
`snakie-parts/registry.json`; it looks like:

```json
{
  "schema": 1,
  "libraries": [
    {
      "id": "pimoroni",
      "name": "Pimoroni Parts",
      "description": "Boards & breakouts from Pimoroni",
      "author": "Pimoroni",
      "repo": "https://github.com/pimoroni/snakie-parts",
      "version": "2.0.0",
      "tags": ["rp2350", "breakout"]
    }
  ]
}
```

In the Parts view, **Add library** fetches the registry and lists the libraries
you don't already have. **Install** clones the entry's `repo` into
`<userData>/parts/<id>` and records the registry `version` in its `library.yml`.

## Version control & updates

Both libraries and parts carry a **SemVer** `version`. Snakie compares each
installed library's version against the registry's latest; when the registry has
a **newer** version it shows an **⬆ update** badge — click it to re-install
(a fresh clone) and pick up the new parts. (See `src/shared/part-registry.ts` for
the exact ordering rules — `1.2` == `1.2.0`, a leading `v` is tolerated, and a
pre-release like `1.0.0-beta` sorts *below* `1.0.0`.)

## Authoring parts

You rarely hand-write `parts.yml`. The **Part Editor** authors it visually and
writes the folder + asset for you — see [part-editor.md](part-editor.md). Parts
you create land in an auto-created local **My Parts** library
(`<userData>/parts/my-parts/`).

## See also

- [Part Editor](part-editor.md) — author parts (schematic + breadboard).
- [Board View](board.md) — the live pin-wiring view the parts feed into.
- The shape lives in `src/shared/part.ts`; the YAML (de)serialisation in
  `src/shared/part-yaml.ts`; the registry/version logic in
  `src/shared/part-registry.ts` (all kept in sync with this doc).
