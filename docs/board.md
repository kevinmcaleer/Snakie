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

The built-in pinouts follow each board's **published reference pinout** (real
physical edge order, true power/ground rails, and the USB / MCU / wifi / LED in
their real positions). The Tiny 2040 / Tiny 2350 are drawn with their pins
running **vertically** (down the two long edges). You can still override any
built-in by dropping a JSON file with the same `id` (see below).

## Authoring a board

There are two ways to author a board:

1. **The Board Creator (visual editor).** Click the brass **create** knob in the
   Board View title bar to enter design mode. It gives you board meta (name, chip
   type, PCB colour, aspect), an **image upload OR rectangle-drawing** tool for
   the board representation, a **pin-assignment tool** (headers per edge; each pad
   gets a GPIO number, name, silk label, and type), an **onboard-LED** picker, a
   **live preview** (the same drawing the view uses), and **Save / Load / Delete /
   New**. Saving writes the JSON below to `<userData>/boards/<id>.json`; the JSON
   is the round-trippable source of truth, so **Load** re-opens any saved board to
   re-edit it. ("Export SVG" is a one-way convenience — it doesn't re-load.)
2. **By hand.** A board is a single **JSON** file matching the `BoardDefinition`
   schema. Drop it in your Snakie boards folder and it appears in the selector
   next time the window opens.

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
  name?: string   // human pin NAME, distinct from the silk label (see below)
  type?: 'gpio' | 'gnd' | 'vcc' | 'other'  // electrical role; defaults to 'gpio'
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
  mcu: string        // sub-label / chip type, e.g. "RP2350"
  pcbColor: string   // PCB fill (any CSS colour)
  aspect: number     // width / height of the outline (drives the drawing)
  ledLabel?: string  // onboard-LED pin token, e.g. "LED" or "25"
  features?: BoardFeature[]  // decorative chips/cans drawn as labelled rects
  headers: BoardHeader[]     // the castellated pads / pin headers
  image?: string     // optional board photo/SVG as a data URL (see below)
}
```

### Pad `name`, `label`, and `type`

- **`label`** is the **silk text** printed next to the pad — it's both what's
  drawn and what the pin parser matches (`GP0`, `3V3`, `IO34`). Required.
- **`name`** is the **human pin name**, separate metadata you can author for your
  own reference (e.g. label `"GP0"`, name `"UART0 TX"`). The renderer matches on
  `label`/`gpio`, never on `name`, so it's purely informational.
- **`type`** is the pad's **electrical role** and defaults to `'gpio'` when
  absent (so older boards still draw):
  - `gpio` — a real GPIO pad. Only these are matched against parsed `Pin(...)`
    tokens and highlighted when wired. Give it a `gpio` number.
  - `gnd` — ground. Drawn dark; never wired/highlighted.
  - `vcc` — a power rail (`3V3`, `5V`, `VBUS`…). Drawn red; never wired.
  - `other` — any non-GPIO signal (`RUN`, `EN`, `ADC_VREF`…). Drawn grey;
    never wired.

  Power/other pads always show their `label` on the board; GPIO pads only show
  theirs when a wire lands on them (to keep the live view uncluttered).

### `image` — a board photo or SVG background

`image` is an optional, self-contained **data URL**
(`data:image/png;base64,…`, or `data:image/svg+xml,…`) drawn as the board
background, clipped to the rounded PCB outline, behind the features and pads. The
Board Creator's "Upload image" stores whatever you pick verbatim, so it
round-trips: re-opening the board re-loads the same image. Leave it out to draw a
plain coloured PCB with your `features` rectangles instead.

### Coordinates & layout

- **`aspect`** is the outline's width ÷ height. The board is scaled to fit the
  window and centred; pick a value that matches the real board's proportions
  (a Pico is roughly `0.52`; a tiny square-ish board is wider, e.g. `1.26`).
- **Headers** lay their `pins` out **evenly** from one end of the edge to the
  other, in array order. `left`/`right` edges run top→bottom; `top`/`bottom`
  edges run left→right. List a pad for every physical position (including power
  and ground pads as plain labels) so the spacing matches the real board. Each
  pad's silk label is drawn **on its own side, outside the board** — a
  `left`-edge pad's label sits to its left, a `right`-edge pad's to its right,
  and `top`/`bottom` labels above/below — so labels never overlap the board.
  (For a small board with castellations down its long edges, like the Tiny
  2040/2350, use `left` + `right` so the pins read **vertically**.)
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
        { "label": "5V", "name": "5V In", "type": "vcc" },
        { "label": "GND", "name": "Ground", "type": "gnd" },
        { "gpio": 0, "label": "GP0", "name": "UART0 TX", "type": "gpio" },
        { "gpio": 1, "label": "GP1", "name": "UART0 RX", "type": "gpio" },
        { "gpio": 2, "label": "GP2", "type": "gpio" }
      ]
    },
    {
      "edge": "bottom",
      "pins": [
        { "gpio": 28, "label": "A2" },
        { "gpio": 27, "label": "A1" },
        { "gpio": 26, "label": "A0" },
        { "label": "3V3", "name": "3.3V Out", "type": "vcc" }
      ]
    }
  ]
}
```

> The `type` defaults to `gpio` when omitted, so the older `{ "label": "GND" }`
> shorthand still works — but tagging power pads `gnd`/`vcc` draws them in their
> proper colours and stops them being treated as wireable GPIO.

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

## See also

- [Instruments library](instruments-library.md) — make the Oscilloscope,
  Multimeter and Plotter update live from a running program by **printing**
  readings (no REPL polling / no loop interruption).
