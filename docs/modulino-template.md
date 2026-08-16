# Building a Modulino part

*Part of the Modulinos epic ([#721](https://github.com/kevinmcaleer/Snakie/issues/721));
the shared half is [#722](https://github.com/kevinmcaleer/Snakie/issues/722).*

Every Arduino Modulino is the **same board** — 41 × 25.36 × 1.6 mm, four Ø3.2 mm
mounting holes on a 16 × 32 mm pitch, a QWIIC socket at each end wired to one
I²C bus in parallel — and only the top-side hardware differs. So the shared half
is authored **once** and each module fills in the rest. Build a new module by
copying `modulino-buttons/` and changing what genuinely differs; you should
never be re-deriving the outline, the connectors or the driver wiring.

`test/modulinoParts.test.ts` enforces everything below across every
`modulino-*` part, so a module that drifts from the template fails CI rather
than shipping as a subtly different 41 mm board.

---

## 1. The mesh — generated, never hand-modelled

`scripts/modulino-mesh.mjs` builds the board from the published dimensions with
three.js and writes a binary STL (~53 KB, versus 360 KB for a hand-modelled part
like the SG90).

```bash
npm run parts:modulino-meshes          # refresh every modulino-* part's copy
node scripts/modulino-mesh.mjs --list  # which toppers exist
```

Each part folder holds its **own copy** of `modulino.stl`. That duplication is
deliberate: `Part.mesh` is a filename *within* the part folder, and at ~53 KB a
copy per module is far cheaper than the schema change a shared path would need.
Because it is generated, `--all` re-syncs every copy from one edit.

**Raised hardware.** Most modules are flat enough that the bare PCB reads right.
Three are not — Joystick, Knob and Vibro — so those get a simple **topper**
primitive on top of the shared PCB (epic policy (b): not twelve full models, not
a Joystick that looks like a blank board). Add yours to `TOPPERS` in the script,
keyed by the folder suffix, and `--all` picks it up automatically:

```js
// scripts/modulino-mesh.mjs
export const TOPPERS = {
  knob: [
    { kind: 'box', w: 12, d: 12, h: 6.5, x: 0, y: 0 },
    { kind: 'cylinder', diameter: 12, h: 6, x: 0, y: 0, z: 6.5 }
  ]
}
```

> **Provenance.** The dimensions come from Arduino's product pages via #721, not
> a mechanical drawing. Arduino publish STEP/CAD per module — #722 carries a
> checkbox to verify against them. Every number is a named constant in the
> script, so a correction is a one-line change plus `--all`.

## 2. The part skeleton

Copy `examples/parts/snakie-standard/modulino-buttons/parts.yml`. What stays the
same for every module:

```yaml
manufacturer: Arduino
package: SMD
voltage: 3.3V
pcbColor: "#00979d"
aspect: 1.617                 # 41 / 25.36
dimensions: { width: 41, height: 25.36 }
mesh: modulino.stl
meshUnits: mm
mass_g: 4.0                   # the range is 3.5–4.4 g
mountingHoles:                # (±16, ±8) mm → normalised
  - { x: 0.10976, y: 0.18454, diameter: 3.2 }
  - { x: 0.89024, y: 0.18454, diameter: 3.2 }
  - { x: 0.89024, y: 0.81546, diameter: 3.2 }
  - { x: 0.10976, y: 0.81546, diameter: 3.2 }
```

What changes per module: `id`, `name`, `description`, `family`, `tags`,
`partNumber`, `properties`, `i2cAddresses`, and the top-side items (`buttons`,
`leds`, shapes) that make it look like itself.

### Both sockets, one bus

Two `qwiic` connectors at `x: 0.05488` and `x: 0.94512`, `y: 0.5`. The second
socket's pins are suffixed `-B` so every endpoint is unambiguous, and the two
are then joined by **rails** — that parallel wiring is what makes Modulinos
daisy-chainable, and without it a module chained downstream reads as unpowered:

```yaml
rails:
  - { name: GND, pins: [GND, GND-B] }
  - { name: 3V3, pins: [3V3, 3V3-B] }
  - { name: SDA, pins: [SDA, SDA-B] }
  - { name: SCL, pins: [SCL, SCL-B] }
```

Pins carry `capabilities: [i2c]` + `signals.i2c` and **no `gpio` field** — these
are peripherals, not MCU boards.

## 3. The driver — one package for the whole range

All thirteen modules install the same library, so they share **one catalog
module** (`modulino` in `src/shared/modules-catalog.ts`) rather than each
carrying its own mip spec:

```yaml
library:
  module: modulino
  docs: https://docs.arduino.cc/hardware/modulino-<module>/
drivers:
  - source: module:modulino
    target: lib/modulino
    label: Arduino Modulino library
```

The Driver Install banner probes `module:` drivers **by import**, so a board
with five Modulinos on it is offered a *single* install, not five identical
ones. Its `package.json` declares `deps` — `lsm6dsox`,
`micropython-ltr-381rgb-01` and `MicroPython_HS3003` — and `mip` installs those
transitively on the device, which is what makes Movement, Light and Thermo work
at all.

## 4. Addresses

Declare the module's address in `i2cAddresses` (decimal in YAML: `0x7C` → `124`)
**and** add it to `KNOWN_I2C_DEVICES` in
`src/renderer/src/components/i2c-known-devices.ts` prefixed `Modulino …`, so an
I²C scan names the module instead of printing bare hex. The conformance test
requires both.

| Address | Module | Re-addressable? |
|---|---|---|
| `0x04` | Latch Relay | yes |
| `0x29` | Distance | **no** — VL53L4CD |
| `0x3C` | Buzzer | yes |
| `0x44` | Thermo | **no** — HS3003 |
| `0x48` | Motors | yes |
| `0x53` | Light | **no** — LTR-381RGB-01 |
| `0x58` | Joystick | yes |
| `0x6A` / `0x6B` | Movement | **no** — LSM6DSOX |
| `0x6C` | Pixels | yes |
| `0x70` | Vibro | yes |
| `0x72` | LED Matrix | yes |
| `0x74` / `0x76` | Knob | yes |
| `0x7C` | Buttons | yes |

The **no** rows have no onboard MCU — the sensor chip answers directly, so the
address is fixed in silicon and two of that module can't share a chain. Say so
in that part's `help.md`.

## 5. The help page

Copy `modulino-buttons/help.md`: what it is, the address (and whether it can be
re-addressed), the wiring table, a runnable snippet, the install line, the full
address table, and links. Keep the address table in every module's help so a
chained stack documents itself.

## Checklist

- [ ] Folder `modulino-<module>/` with `parts.yml`, `help.md`
- [ ] `npm run parts:modulino-meshes` (add a `TOPPERS` entry first if it isn't flat)
- [ ] Address in `i2cAddresses` **and** `KNOWN_I2C_DEVICES`
- [ ] `npx vitest run test/modulinoParts.test.ts test/partExamples.test.ts`
