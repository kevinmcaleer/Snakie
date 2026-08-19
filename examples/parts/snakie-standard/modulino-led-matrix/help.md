# Modulino LED Matrix

**96 blue LEDs in an 8 × 12 grid**, charlieplexed and driven by an onboard
STM32C011, so the whole thing hangs off two I²C wires. You draw into a
framebuffer with the same calls you'd use on an OLED — pixels, lines, shapes,
scrolling text — then push the frame to the board.

## The one thing that catches everyone: `show()`

Every drawing call writes to a buffer **in the Pico's memory**, not to the
board. Nothing lights up until you push it:

```python
from modulino import ModulinoLEDMatrix

matrix = ModulinoLEDMatrix()

matrix.set_pixel(3, 4)
matrix.show()          # <- without this, nothing happens
```

If your matrix stays dark and the code looks right, this is almost always why.
The calls chain, so `matrix.clear().show()` is the usual way to blank it.

## Address — `0x39`, and it *can* move

This module has its own MCU, so the address is software-settable if you need two
on one chain.

**Careful reading the docs:** the MicroPython library lists this module as
`0x72`, but that's the **8-bit** form — the firmware answers on `0x72 >> 1` =
**`0x39`**, which is what an I²C scan reports and what Arduino's store quotes.
Every Modulino *with* an MCU works this way. The four bare-sensor ones
(Distance, Thermo, Light, Movement) have no MCU and use their sensor's real
7-bit address unshifted.

## Wiring

A QWIIC socket at **each end**, both on the same bus in parallel — plug into
either and chain the next module off the other.

| Pin | What |
|---|---|
| GND | ground |
| 3V3 | 3.3 V |
| SDA | I²C data |
| SCL | I²C clock |

## Code

```python
from modulino import ModulinoLEDMatrix

matrix = ModulinoLEDMatrix()
matrix.clear().show()

# On a non-Arduino board, or if construction reports it can't find the module on
# the bus, hand it both the bus and the address — see below.

matrix.set_pixel(0, 0)          # x 0-11, y 0-7
matrix.text(0, 0, "Hi")
matrix.show()
```

Drawing calls mirror MicroPython's `FrameBuffer`:

| Call | Does |
|---|---|
| `set_pixel(x, y)` / `clear_pixel(x, y)` | one LED |
| `line(x1, y1, x2, y2)` | a line |
| `rect(x, y, w, h)` / `ellipse(x, y, w, h)` | shapes |
| `text(x, y, "…")` | 8×8 font — about 1½ characters fit |
| `scroll(dx, dy)` | shift the buffer |
| `fill(colour)` / `clear()` | all on / all off |
| `show()` | **push the buffer to the board** |

### Scrolling a message

The panel is only 12 columns wide, so anything longer than a character or two
has to scroll.

### Why `scroll()` doesn't do this

There is a `scroll(dx, dy)`, and it is the obvious thing to reach for. It won't
work, for three reasons that stack up:

- **The text isn't there to scroll.** `text()` draws into the 12 × 8 buffer with
  an 8 × 8 font, so only the first character and a half ever become pixels. The
  rest of the string is clipped as it is drawn — it is not held off-screen
  waiting to slide in. Scrolling cannot reveal what was never rendered.
- **It doesn't wrap.** Content pushed past an edge is gone, not brought round the
  other side. So even the character and a half you have simply leaves.
- **The vacated area isn't cleared.** MicroPython's own `framebuf` docs warn that
  scroll "may leave a footprint of the previous colours" — the space behind the
  shift is undefined rather than blank, which is why a naive scroll loop smears.

`scroll()` is a **buffer** operation, for animating something already drawn in
full: nudging a sprite, a bouncing dot, shifting a 12 × 8 image. The name invites
the misreading, because "scroll" on a display usually means scrolling a document.

None of this is specific to the Modulino — it is how `framebuf` behaves
everywhere, including on an SSD1306. A 128-wide OLED just hides it for longer;
twelve columns make it bite immediately.

So a marquee redraws each frame, at a moving negative offset. Every frame draws
the **whole** string from a shifted origin, so the panel's clipping window lands
on a different slice of it — and letters genuinely arrive from the right because
they are re-rendered, not shuffled along:

```python
from time import sleep_ms

message = "HELLO"
WIDTH = 12                       # the panel is 12 columns wide

# Start at -WIDTH so the first frame draws the text just off the RIGHT edge, and
# run until it has fully left on the left. Starting at 0 would open with the
# message already sitting on the panel, which is not what a marquee should do.
for step in range(-WIDTH, len(message) * 8):
    matrix.clear()
    matrix.text(-step, 0, message)
    matrix.show()
    sleep_ms(80)
```

### Grayscale

Ask for it at construction and each pixel takes a brightness of 0–15 instead of
on/off. The frame buffer grows from 12 bytes to 48, so it's a little slower to
push:

```python
matrix = ModulinoLEDMatrix(use_grayscale=True)
matrix.set_pixel(5, 3, 8)    # half brightness
matrix.show()
```

### Animations

`Animation` takes `(frame_bytes, duration_ms)` pairs; `FPSAnimation` takes plain
frames at a fixed rate:

```python
from modulino import ModulinoLEDMatrix, Animation

frames = [
    (b'\x00\x00\x00\x00\x10\x00\x00\x00\x00\x00\x00\x00', 66),
    (b'\x00\x00\x00\x20\x10\x00\x00\x00\x00\x00\x00\x00', 40),
]
Animation(matrix, frames).play(loop=True)
```

A monochrome frame is 12 bytes; a grayscale one is 48.

## On a non-Arduino board, pass the I²C bus yourself

The library works out which pins carry I²C from `os.uname().machine`, against a
table of **Arduino** boards. On anything else — a Pico, a Tiny 2350, an ESP32 —
that lookup fails and construction raises:

```
RuntimeError: I2C interface couldn't be determined automatically for '<your board>'
```

It isn't a wiring fault, and nothing is wrong with the module. Hand it a bus and
it works:

```python
from machine import I2C, Pin
from modulino import ModulinoLEDMatrix

# Use YOUR board's I²C pins — Snakie shows them on the board's pinout.
i2c = I2C(0, sda=Pin(4), scl=Pin(5))

# Naming the address skips the library's auto-discovery, which does not find
# every board. Snakie has this number on the part's details page.
matrix = ModulinoLEDMatrix(i2c_bus=i2c, address=0x39)
```

Every Modulino class takes `i2c_bus`, so one bus serves a whole chain — build it
once and pass it to each module.

## Install the library

One package covers every Modulino:

```python
mip.install("github:arduino/arduino-modulino-mpy")
```

Snakie offers this for you when you place a Modulino on the board — and only
once, however many Modulinos your design has.

## Modulino addresses

As they appear **in a bus scan**:

| Address | Module | Re-addressable? |
|---|---|---|
| `0x02` | Latch Relay | yes |
| `0x1E` | Buzzer | yes |
| `0x24` | Motors | yes |
| `0x29` | Distance | **no** — VL53L4CD |
| `0x2C` | Joystick | yes |
| `0x36` | Pixels | yes |
| `0x38` | Vibro | yes |
| `0x39` | **LED Matrix** | yes |
| `0x3A` / `0x3B` | Knob | yes |
| `0x3E` | Buttons | yes |
| `0x44` | Thermo | **no** — HS3003 |
| `0x53` | Light | **no** — LTR-381RGB-01 |
| `0x6A` / `0x6B` | Movement | **no** — LSM6DSOX |

## Links

- [Product page](https://docs.arduino.cc/hardware/modulino-ledmatrix/) (ABX00152)
- [MicroPython library](https://github.com/arduino/arduino-modulino-mpy)
