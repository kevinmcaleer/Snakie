# Modulino Pixels

Eight **LC8822-2020** addressable RGB LEDs in a row, each with its own colour and
its own brightness. An onboard **STM32C011F4** drives them, so there's no strict
bit-banged timing to get right — you send colours over I²C.

## Address — `0x36`

There's an MCU on this one, so the address is **software-configurable** — which
is how you run two Pixels strips on one chain.

Mind the shift if you go reading Arduino's own material: the library declares the
module's *pinstrap* as `0x6C`, and the firmware answers on **half** that. `0x36`
is what a bus scan reports.

## Wiring

A QWIIC socket at **each end**, both on the same bus in parallel — plug into
either and chain the next module off the other.

| Pin | What |
|---|---|
| GND | ground |
| 3V3 | 3.3 V |
| SDA | I²C data |
| SCL | I²C clock |

Eight LEDs at full white is roughly **80 mA** off the QWIIC 3V3 rail. That's fine
on its own; it's worth remembering when this is the fourth module on a chain.

## Code

Every setter only stages a change. **Nothing lights up until `.show()`** — that's
the one thing that catches people out:

```python
from modulino import ModulinoPixels, ModulinoColor

pixels = ModulinoPixels()

pixels.set_all_color(ModulinoColor.BLUE, 50)
pixels.show()
```

| Call | What |
|---|---|
| `.set_rgb(i, r, g, b, brightness)` | one LED, 0–255 each, brightness 0–100 |
| `.set_color(i, color, brightness)` | one LED from a `ModulinoColor` |
| `.set_range_rgb(from, to, r, g, b, brightness)` | an inclusive span |
| `.set_all_rgb(r, g, b, brightness)` / `.set_all_color(…)` | all eight |
| `.set_brightness(i, b)` / `.set_all_brightness(b)` | brightness alone |
| `.clear(i)` / `.clear_range(from, to)` / `.clear_all()` | off |
| `.show()` | push the staged frame to the LEDs |

`ModulinoColor` ships `RED`, `GREEN`, `BLUE`, `YELLOW`, `CYAN`, `MAGENTA` and
`WHITE`, and you can build your own with `ModulinoColor(r, g, b)`.

### Index them like a list

The setters return the object, so they chain; and `pixels[i] = …` works with a
3- or 4-tuple (the fourth being brightness), or `None` to clear one:

```python
from modulino import ModulinoPixels

pixels = ModulinoPixels()

pixels[0] = (255, 0, 0)        # red, full brightness
pixels[1] = (0, 255, 0, 25)    # green, dimmed
pixels[2] = None               # off
pixels.show()
```

### A moving dot

Brightness is separate from colour, which makes a fading trail easy — set the
colour once, then walk the brightness along:

```python
from modulino import ModulinoPixels, ModulinoColor
from time import sleep

pixels = ModulinoPixels()

while True:
    for i in range(8):
        pixels.clear_all()
        pixels.set_color(i, ModulinoColor.CYAN, 60)
        pixels.show()
        sleep(0.08)
```

Indices are **0–7**; anything outside raises `ValueError` rather than silently
doing nothing.

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
| `0x36` | **Pixels** | yes |
| `0x38` | Vibro | yes |
| `0x39` | LED Matrix | yes |
| `0x3A` / `0x3B` | Knob | yes |
| `0x3E` | Buttons | yes |
| `0x44` | Thermo | **no** — HS3003 |
| `0x53` | Light | **no** — LTR-381RGB-01 |
| `0x6A` / `0x6B` | Movement | solder jumper only |

## Links

- [Product page](https://docs.arduino.cc/hardware/modulino-pixels/) (ABX00109)
- [MicroPython library](https://github.com/arduino/arduino-modulino-mpy)
