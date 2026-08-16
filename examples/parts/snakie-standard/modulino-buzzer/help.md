# Modulino Buzzer

A Murata piezo buzzer driven over I²C, with an **STM32C011** doing the timing for
you: ask for a frequency and a duration, and the board plays it.

## Address

**`0x3C`**, software-configurable — there's an MCU on this one, so two Buzzers
can share a chain. Worth knowing it collides with the default address of the very
common **SSD1306 / SH1106 OLED**; if a scan shows `0x3C` and you have a display
on the bus too, one of them has to move.

## Wiring

A QWIIC socket at **each end**, both on the same bus in parallel.

| Pin | What |
|---|---|
| GND | ground |
| 3V3 | 3.3 V |
| SDA | I²C data |
| SCL | I²C clock |

## Code

```python
from modulino import ModulinoBuzzer

buzzer = ModulinoBuzzer()

buzzer.tone(440, 500, blocking=True)   # A4 for half a second
buzzer.no_tone()
```

`blocking=True` waits for the note to finish; without it the call returns
immediately and your code carries on while the note sounds — which is what you
want inside a robot's control loop, where stopping for half a second means
driving blind for half a second.

### The NOTES table

The driver ships note names, so you can write music instead of frequencies:

```python
from modulino import ModulinoBuzzer

buzzer = ModulinoBuzzer()

melody = [
    (ModulinoBuzzer.NOTES["C4"], 200),
    (ModulinoBuzzer.NOTES["E4"], 200),
    (ModulinoBuzzer.NOTES["G4"], 200),
    (ModulinoBuzzer.NOTES["C5"], 400),
]

for note, ms in melody:
    buzzer.tone(note, ms, blocking=True)
buzzer.no_tone()
```

A rest is just a gap — `time.sleep_ms(ms)` with no tone.

## The Buzzer instrument

Snakie's **Buzzer** panel doesn't drive this board yet. The panel plays through a
`machine.PWM` on a GPIO pin (it sets `freq()` and `duty_u16()` directly); this
Modulino takes its notes over I²C instead, so there's no PWM pin for the panel to
target. A small adapter bridges the two — tracked separately.

Everything above works today from your own code.

## Install the library

One package covers every Modulino:

```python
mip.install("github:arduino/arduino-modulino-mpy")
```

Snakie offers this for you when you place a Modulino on the board — and only
once, however many Modulinos your design has.

## Modulino addresses

| Address | Module | Re-addressable? |
|---|---|---|
| `0x04` | Latch Relay | yes |
| `0x29` | Distance | **no** — VL53L4CD |
| `0x3C` | **Buzzer** | yes |
| `0x44` | Thermo | **no** — HS3003 |
| `0x48` | Motors | yes |
| `0x53` | Light | **no** — LTR-381RGB-01 |
| `0x58` | Joystick | yes |
| `0x6A` / `0x6B` | Movement | **no** — LSM6DSOX |
| `0x6C` | Pixels | yes |
| `0x70` | Vibro | yes |
| `0x72` | LED Matrix | yes |
| `0x74` / `0x76` | Knob | yes |
| `0x7C` | Buttons | yes |

## Links

- [Product page](https://docs.arduino.cc/hardware/modulino-buzzer/) (ABX00108)
- [MicroPython library](https://github.com/arduino/arduino-modulino-mpy)
