# Modulino Joystick

A two-axis analogue thumbstick with a push-to-click button, read over I²C. An
**STM32C011F4** samples both axes and the button for you, so you get numbers
rather than an ADC to babysit.

## Address — `0x2C`

There's an MCU on this one, so the address is **software-configurable** — which
is how you run two Joysticks on one chain.

Mind the shift if you go reading Arduino's own material: the library declares the
module's *pinstrap* as `0x58`, and the firmware answers on **half** that. `0x2C`
is what a bus scan reports, and it's what this part declares.

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
`True` when something actually moved, so it doubles as your change test:

```python
from modulino import ModulinoJoystick

joystick = ModulinoJoystick()

while True:
    if joystick.update():
        print(joystick.x, joystick.y, joystick.button_pressed)
```

| Member | What |
|---|---|
| `.update()` | reads the board; `True` if the position or button changed |
| `.x` / `.y` | position, centred on **0** (roughly −128…+127) |
| `.button_pressed` | `True` while the stick is clicked in |
| `.deadzone_threshold` | counts around centre that snap to 0 — default `10` |
| `.long_press_duration` | milliseconds that count as a long press — default `1000` |

The axes are **not** properties that fetch: `.x` and `.y` hand back what the last
`.update()` read. Call it in your loop or the stick appears stuck.

### Buttons by callback

If you'd rather not poll for the click, hand it a function. The callbacks still
fire from inside `.update()`, so it must keep being called:

```python
from modulino import ModulinoJoystick

joystick = ModulinoJoystick()
joystick.on_button_press = lambda: print("pressed")
joystick.on_button_release = lambda: print("released")
joystick.on_button_long_press = lambda: print("held")

while True:
    joystick.update()
```

### The deadzone

A thumbstick never quite returns to centre, so anything within
`.deadzone_threshold` counts of the middle is forced to exactly 0. Widen it if a
worn stick creeps; narrow it for finer control:

```python
from modulino import ModulinoJoystick

joystick = ModulinoJoystick()

joystick.deadzone_threshold = 20
```

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
| `0x2C` | **Joystick** | yes |
| `0x36` | Pixels | yes |
| `0x38` | Vibro | yes |
| `0x39` | LED Matrix | yes |
| `0x3A` / `0x3B` | Knob | yes |
| `0x3E` | Buttons | yes |
| `0x44` | Thermo | **no** — HS3003 |
| `0x53` | Light | **no** — LTR-381RGB-01 |
| `0x6A` / `0x6B` | Movement | solder jumper only |

## Links

- [Product page](https://docs.arduino.cc/hardware/modulino-joystick/) (ABX00135)
- [MicroPython library](https://github.com/arduino/arduino-modulino-mpy)
