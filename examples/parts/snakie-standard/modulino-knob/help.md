# Modulino Knob

A **PEC11J** rotary encoder with a push switch, counted for you by an onboard
**STM32C011F4**. It turns forever in either direction — there are no end stops,
just a running count of steps — and the shaft clicks in as a button.

## Address — `0x3A` or `0x3B`

There's an MCU on this one, so the address is **software-configurable**. It also
ships with **two** defaults rather than one, which is the neat bit: buy two Knobs
and they'll sit at `0x3A` and `0x3B` and coexist on one chain with nothing to
configure. The library tries both in turn, so you don't normally say which.

Mind the shift if you go reading Arduino's own material: the library declares the
*pinstraps* as `0x74` / `0x76`, and the firmware answers on **half** those.
`0x3A` / `0x3B` is what a bus scan reports.

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

Nothing updates until you call `.update()` — it does the I²C read and returns
`True` when the count or the button changed:

```python
from modulino import ModulinoKnob

knob = ModulinoKnob()
knob.value = 0

while True:
    if knob.update():
        print(knob.value, knob.pressed)
```

| Member | What |
|---|---|
| `.update()` | reads the board; `True` if the value or button changed |
| `.value` | step count — **read *and* write**, so you can seed or zero it |
| `.pressed` | `True` while the shaft is pressed in |
| `.range` | `(min, max)` to clamp the count; unset means free-running |
| `.reset()` | back to 0 |

### Clamp it to something useful

Left alone the count runs from −32768 to 32767, which is rarely what you want.
Give it a range and the driver clamps for you — so a knob can *be* a volume
control rather than feed one:

```python
from modulino import ModulinoKnob

knob = ModulinoKnob()
knob.range = (0, 100)
knob.value = 50
```

### By callback

The rotation callbacks are handed **both** the number of steps moved and the new
value, so a fast spin moves further than a slow one. They fire from inside
`.update()`, so it must keep being called:

```python
from modulino import ModulinoKnob

knob = ModulinoKnob()

knob.on_rotate_clockwise = lambda steps, value: print("cw", steps, value)
knob.on_rotate_counter_clockwise = lambda steps, value: print("ccw", steps, value)
knob.on_press = lambda: print("pressed")
knob.on_release = lambda: print("released")

while True:
    knob.update()
```

Note `on_press` / `on_release` take **no** arguments, unlike the rotation pair.

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
from modulino import ModulinoKnob

# Use YOUR board's I²C pins — Snakie shows them on the board's pinout.
i2c = I2C(0, sda=Pin(4), scl=Pin(5))

knob = ModulinoKnob(i2c_bus=i2c)
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
| `0x39` | LED Matrix | yes |
| `0x3A` / `0x3B` | **Knob** | yes |
| `0x3E` | Buttons | yes |
| `0x44` | Thermo | **no** — HS3003 |
| `0x53` | Light | **no** — LTR-381RGB-01 |
| `0x6A` / `0x6B` | Movement | solder jumper only |

## Links

- [Product page](https://docs.arduino.cc/hardware/modulino-knob/) (ABX00107)
- [MicroPython library](https://github.com/arduino/arduino-modulino-mpy)
