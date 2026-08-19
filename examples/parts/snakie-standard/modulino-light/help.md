# Modulino Light

An **LTR-381RGB-01** on Arduino's I²C Modulino board: ambient light in lux, red,
green and blue channels, a colour temperature in kelvin, and infrared — so it
can tell you how bright a room is *and* what colour the light in it is.

## Address — this one is fixed

**`0x53`, and it cannot be changed.** There's no MCU on this board: the
LTR-381RGB-01 answers for itself, so the address is set in silicon. Two Light
modules **cannot share a chain**.

That's the split across the range: the modules with an onboard MCU (Buttons,
Buzzer, Knob, Pixels, Motors…) can be re-addressed; the four bare-sensor ones
(Light, Distance, Thermo, Movement) can't.

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
from modulino import ModulinoLight

light = ModulinoLight()

print(light.lux)                      # ambient brightness
print(light.r, light.g, light.b)      # colour channels
print(light.colour_temperature)       # kelvin
print(light.ir)                       # infrared
```

Reach the chip directly for gain and integration time when the defaults don't
suit — a dim room or a fast-moving robot both want tuning:

```python
from modulino import ModulinoLight

light = ModulinoLight()

light.sensor          # the underlying LTR-381RGB-01 driver
```

## Install the library

One package covers every Modulino, and this one needs a second: the Modulino
package's `deps` pull in `github:arduino/micropython-ltr-381rgb-01`, and `mip`
installs it for you.

```python
mip.install("github:arduino/arduino-modulino-mpy")
```

Snakie offers this when you place a Modulino on the board — once, however many
Modulinos your design has. **If the extra dependency doesn't arrive, this module
won't import**: check the board has a network connection when installing, since
mip fetches the deps at install time.

## Modulino addresses

| Address | Module | Re-addressable? |
|---|---|---|
| `0x04` | Latch Relay | yes |
| `0x29` | Distance | **no** — VL53L4CD |
| `0x3C` | Buzzer | yes |
| `0x44` | Thermo | **no** — HS3003 |
| `0x48` | Motors | yes |
| `0x53` | **Light** | **no** — LTR-381RGB-01 |
| `0x58` | Joystick | yes |
| `0x6A` / `0x6B` | Movement | **no** — LSM6DSOX |
| `0x6C` | Pixels | yes |
| `0x70` | Vibro | yes |
| `0x72` | LED Matrix | yes |
| `0x74` / `0x76` | Knob | yes |
| `0x7C` | Buttons | yes |

## Links

- [Product page](https://docs.arduino.cc/hardware/modulino-light/) (ABX00111)
- [MicroPython library](https://github.com/arduino/arduino-modulino-mpy)
