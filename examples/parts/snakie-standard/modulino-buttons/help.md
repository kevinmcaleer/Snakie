# Modulino Buttons

Three momentary buttons — **A**, **B**, **C** — each with an LED above it, on
Arduino's I²C **Modulino** board. Plug it into any QWIIC/STEMMA-QT port, or chain
it off another Modulino.

## Address

**`0x3E`.** There is an MCU on this board rather than a bare sensor chip, so the
address is **re-addressable** — two Buttons modules can share one chain once
you've moved one of them.

The MicroPython library lists this module as `0x7C` — that's the **8-bit**
form. The firmware answers on `0x7C >> 1` = **`0x3E`**, which is what a bus
scan reports. Every Modulino *with* an MCU works this way; the four bare-sensor
ones (Distance, Thermo, Light, Movement) use their sensor's 7-bit address as-is.


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
| `0x02` | Latch Relay | yes |
| `0x1E` | Buzzer | yes |
| `0x24` | Motors | yes |
| `0x29` | Distance | **no** — VL53L4CD |
| `0x2C` | Joystick | yes |
| `0x36` | Pixels | yes |
| `0x38` | Vibro | yes |
| `0x39` | LED Matrix | yes |
| `0x3A` / `0x3B` | Knob | yes |
| `0x3E` | **Buttons** | yes |
| `0x44` | Thermo | **no** — HS3003 |
| `0x53` | Light | **no** — LTR-381RGB-01 |
| `0x6A` / `0x6B` | Movement | **no** — LSM6DSOX |

The **no** rows have no onboard MCU: the sensor chip answers directly, so its
address is fixed in silicon and two of that module can't share a chain.

## Links

- [Product page](https://docs.arduino.cc/hardware/modulino-buttons/)
- [MicroPython library](https://github.com/arduino/arduino-modulino-mpy)
