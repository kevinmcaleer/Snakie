# Board View — authoring your own boards

The **Board View** is a separate, always-on-top window that visualises the pin
wiring of the Python file you're editing. Open it from the toolbar's **board**
button; it streams live, so the picture updates as you type.

It works by parsing your MicroPython source for the common `machine` constructors
(`Pin`, `PWM`, `I2C`, `SPI`, `StateMachine`) and drawing a coloured wire from
each used header pad to a **connection-type badge**:

| Type     | Meaning                                                |
| -------- | ------------------------------------------------------ |
| `OUTPUT` | a `Pin` you drive (`Pin.OUT`, or `.on()/.value(1)/…`)  |
| `INPUT`  | a `Pin` you read (`Pin.IN`, or a bare `.value()` read) |
| `PWM`    | a `PWM(Pin(...))`                                       |
| `I2C`    | an `I2C(..., sda=Pin, scl=Pin)` bus                     |
| `SPI`    | an `SPI(..., sck/mosi/miso/cs/dc=Pin)` bus              |
| `PIO`    | a `StateMachine(...)` with a `Pin`                      |

> For an undirected `Pin(15)` (no `Pin.OUT`/`Pin.IN`), the direction is inferred
> from how you later use the variable — a write call (`.on()`, `.off()`,
> `.high()`, `.low()`, `.toggle()`, `.value(<arg>)`) makes it an **output**; a
> bare `.value()` read makes it an **input**; if it can't tell, it defaults to
> **output**.

A **board selector** in the title bar switches between the built-in boards
(Raspberry Pi Pico 2 W, Pimoroni Pico Plus 2, Pimoroni Tiny 2040, Pimoroni Tiny
2350, ESP32 DevKit) and any boards you've authored yourself. Your choice is
remembered.

The built-in pinouts are **best-effort and recognisable**, not guaranteed
pin-perfect — and you can override any of them (see below).

## Authoring a board

A board is a single **JSON** file matching the `BoardDefinition` schema. Drop it
in your Snakie boards folder and it appears in the selector next time the window
opens.

### Where the files go

```
<userData>/boards/<id>.json
```

`<userData>` is the per-user app-data directory Electron picks for Snakie
(e.g. `~/Library/Application Support/Snakie/` on macOS,
`%APPDATA%/Snakie/` on Windows, `~/.config/Snakie/` on Linux).

The fastest way to find it: click the **📁 boards folder** button in the Board
View title bar — it creates the folder if needed and reveals it in your file
manager.

A file whose `id` matches a built-in board **overrides** that built-in, so you
can correct or restyle the bundled boards too.

## Schema

```ts
interface BoardPad {
  gpio?: number   // numeric GPIO this pad breaks out (matched against Pin(n))
  label: string   // silk text drawn on/next to the pad, e.g. "GP0", "3V3", "IO34"
}

interface BoardHeader {
  edge: 'left' | 'right' | 'top' | 'bottom'  // which edge the pads sit on
  pins: BoardPad[]                           // laid evenly along that edge, in order
}

interface BoardFeature {
  label: string                              // silk text on the feature
  kind: 'mcu' | 'wifi' | 'usb' | 'chip' | 'led'  // visual style
  x: number; y: number; w: number; h: number // normalised 0..1 WITHIN the outline
}

interface BoardDefinition {
  id: string         // unique; a user file with this id overrides a built-in
  name: string       // shown in the selector
  mcu: string        // sub-label, e.g. "RP2350"
  pcbColor: string   // PCB fill (any CSS colour)
  aspect: number     // width / height of the outline (drives the drawing)
  ledLabel?: string  // onboard-LED pin token, e.g. "LED" or "25"
  features?: BoardFeature[]  // decorative chips/cans drawn as labelled rects
  headers: BoardHeader[]     // the castellated pads / pin headers
}
```

### Coordinates & layout

- **`aspect`** is the outline's width ÷ height. The board is scaled to fit the
  window and centred; pick a value that matches the real board's proportions
  (a Pico is roughly `0.52`; a tiny square-ish board is wider, e.g. `1.26`).
- **Headers** lay their `pins` out **evenly** from one end of the edge to the
  other, in array order. `left`/`right` edges run top→bottom; `top`/`bottom`
  edges run left→right. List a pad for every physical position (including power
  and ground pads as plain labels) so the spacing matches the real board.
- **Features** use **normalised** coordinates: `x`/`y` are the top-left corner
  and `w`/`h` the size, each `0..1` **relative to the board outline**. So
  `{ x: 0.32, y: 0.42, w: 0.36, h: 0.18 }` is a chip centred a bit above the
  middle. (Values may go slightly outside `0..1` for an overhanging USB nub.)

### How pins match

When the parser finds a pin token (e.g. `15` from `Pin(15)`, or `"LED"`), the
Board View resolves it to a pad like this:

1. A **numeric** token (e.g. `23`) matches a pad whose `gpio` equals it.
2. Otherwise it matches a pad whose `label` equals the token
   (case-insensitive), treating `GP12` and `12` as the same.
3. The board's **`ledLabel`** token (e.g. `"LED"`) lights the onboard-LED dot.
4. An out-of-range numeric token snaps to the **nearest** GPIO pad, so a wire
   still draws.

So: give every broken-out GPIO pad a `gpio` number, and use the silk name your
board prints (e.g. `IO34`, `GP0`, `A0`) as its `label`.

## Complete example

Save this as `<userData>/boards/my-tiny.json` and it appears in the selector as
"My Tiny Board":

```json
{
  "id": "my-tiny",
  "name": "My Tiny Board",
  "mcu": "RP2040",
  "pcbColor": "#1f3a5f",
  "aspect": 1.2,
  "ledLabel": "LED",
  "features": [
    { "label": "RP2040", "kind": "mcu", "x": 0.35, "y": 0.34, "w": 0.3, "h": 0.32 },
    { "label": "USB-C", "kind": "usb", "x": 0.4, "y": -0.04, "w": 0.2, "h": 0.08 }
  ],
  "headers": [
    {
      "edge": "top",
      "pins": [
        { "label": "5V" },
        { "label": "GND" },
        { "gpio": 0, "label": "GP0" },
        { "gpio": 1, "label": "GP1" },
        { "gpio": 2, "label": "GP2" }
      ]
    },
    {
      "edge": "bottom",
      "pins": [
        { "gpio": 28, "label": "A2" },
        { "gpio": 27, "label": "A1" },
        { "gpio": 26, "label": "A0" },
        { "label": "3V3" }
      ]
    }
  ]
}
```

Open a `.py` file that wires one of those pins, e.g.:

```python
from machine import Pin
led = Pin(0, Pin.OUT)   # → OUTPUT badge wired to the GP0 pad
sensor = Pin(26)        # A0; .value() read below makes it an INPUT
if sensor.value():
    led.on()
```

Switch the selector to **My Tiny Board** and you'll see GP0 wired to an
`OUTPUT` badge and A0 (GP26) wired to an `INPUT` badge.

## Tips

- Malformed JSON is skipped (the rest of your boards still load), so a typo in
  one file won't break the others.
- The schema lives in `src/shared/board.ts`; the built-ins are in
  `src/renderer/src/components/board-defs.ts` — copy one as a starting point.
- Keep `id` stable: it's both the filename convention and the key the selector
  remembers.
