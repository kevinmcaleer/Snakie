# Modulino Buttons

Three momentary buttons — **A**, **B**, **C** — each with an LED above it, on
Arduino's I²C **Modulino** board. Plug it into any QWIIC/STEMMA-QT port, or chain
it off another Modulino.

## Address

**`0x7C`.** There is an MCU on this board rather than a bare sensor chip, so the
address is **re-addressable** — two Buttons modules can share one chain once
you've moved one of them.

## Wiring

A QWIIC socket at **each end**, both on the same bus in parallel. That's the
whole point of the format: one lead from the board to the first module, then
module to module.

| Pin | What |
|---|---|
| GND | ground |
| 3V3 | 3.3 V |
| SDA | I²C data |
| SCL | I²C clock |

Either socket can be the input — they're the same four nets.

## Code

```python
from modulino import ModulinoButtons

buttons = ModulinoButtons()
buttons.set_led_status(True, True, True)   # all three LEDs on

while True:
    if buttons.update():                   # True when something changed
        print(buttons.is_pressed(0), buttons.is_pressed(1), buttons.is_pressed(2))
```

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
from modulino import ModulinoButtons

# Use YOUR board's I²C pins — Snakie shows them on the board's pinout.
i2c = I2C(0, sda=Pin(4), scl=Pin(5))

buttons = ModulinoButtons(i2c_bus=i2c)
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

Every module in the range, so a scan of a chain tells you what's on it:

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
| `0x7C` | **Buttons** | yes |

The **no** rows have no onboard MCU: the sensor chip answers directly, so its
address is fixed in silicon and two of that module can't share a chain.

## Links

- [Product page](https://docs.arduino.cc/hardware/modulino-buttons/)
- [MicroPython library](https://github.com/arduino/arduino-modulino-mpy)
