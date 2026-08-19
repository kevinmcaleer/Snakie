# Modulino Vibro

A **VZ43FM1B8230001L** vibration motor for haptic feedback, driven over I²C by an
onboard **STM32C011F4**. You give it a duration and an intensity; the board runs
the motor and stops it on time without your code waiting around.

## Address — `0x38`

There's an MCU on this one, so the address is **software-configurable** — which
is how you run two Vibros on one chain.

Mind the shift if you go reading Arduino's own material: the library declares the
module's *pinstrap* as `0x70`, and the firmware answers on **half** that. `0x38`
is what a bus scan reports — and note that clashes with the common
**AHT10 / AHT20** temperature-humidity breakout, so if a scan shows `0x38` and
you have one of those on the bus, one of them has to move.

## Wiring

A QWIIC socket at **each end**, both on the same bus in parallel — plug into
either and chain the next module off the other.

| Pin | What |
|---|---|
| GND | ground |
| 3V3 | 3.3 V |
| SDA | I²C data |
| SCL | I²C clock |

The motor draws **67 mA typical, 85 mA maximum** while running, on top of the
MCU's ~3.4 mA. That's the biggest single draw on a QWIIC chain — worth checking
your 3V3 supply if the bus misbehaves only while it's buzzing.

## Code

```python
from modulino import ModulinoVibro

vibro = ModulinoVibro()

vibro.on(500)      # buzz for half a second, then stop by itself
```

| Call | What |
|---|---|
| `.on(length_ms, power, blocking)` | run the motor |
| `.off()` | stop it now |

`.on()` **returns immediately** by default — the board's own timer stops the
motor after `length_ms`, so your loop carries on. Pass `blocking=True` if you
want the call to wait it out instead.

Called with no arguments at all, `.on()` runs for 65535 ms — effectively "until
told otherwise".

### Intensity

The `power` argument takes a `PowerLevel` constant rather than a raw number:

```python
from modulino import ModulinoVibro, PowerLevel

vibro = ModulinoVibro()

vibro.on(200, PowerLevel.GENTLE)
```

| Constant | Value |
|---|---|
| `PowerLevel.STOP` | 0 |
| `PowerLevel.GENTLE` | 25 |
| `PowerLevel.MODERATE` | 35 |
| `PowerLevel.MEDIUM` | 45 — the default |
| `PowerLevel.INTENSE` | 55 |
| `PowerLevel.POWERFUL` | 65 |
| `PowerLevel.MAXIMUM` | 75 |

### A double tap

Short bursts read as distinct events; long ones read as an alarm. Because
`.on()` doesn't block, a pattern needs its own timing:

```python
from modulino import ModulinoVibro, PowerLevel
from time import sleep_ms

vibro = ModulinoVibro()

for _ in range(2):
    vibro.on(80, PowerLevel.INTENSE)
    sleep_ms(180)
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
| `0x2C` | Joystick | yes |
| `0x36` | Pixels | yes |
| `0x38` | **Vibro** | yes |
| `0x39` | LED Matrix | yes |
| `0x3A` / `0x3B` | Knob | yes |
| `0x3E` | Buttons | yes |
| `0x44` | Thermo | **no** — HS3003 |
| `0x53` | Light | **no** — LTR-381RGB-01 |
| `0x6A` / `0x6B` | Movement | solder jumper only |

## Links

- [Product page](https://docs.arduino.cc/hardware/modulino-vibro/) (ABX00130)
- [MicroPython library](https://github.com/arduino/arduino-modulino-mpy)
