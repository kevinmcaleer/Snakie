# Modulino Buzzer

A Murata piezo buzzer driven over I²C, with an **STM32C011** doing the timing for
you: ask for a frequency and a duration, and the board plays it.

## Address

**`0x1E`**, software-configurable — there's an MCU on this one, so two Buzzers
can share a chain. Worth knowing it collides with the **HMC5883L magnetometer**
and the mag half of an **LSM303**; if a scan shows `0x1E` and you have one of
those on the bus too, one of them has to move.

The MicroPython library lists this module as `0x3C` — that's the **8-bit**
form. The firmware answers on `0x3C >> 1` = **`0x1E`**, which is what a bus
scan reports. Every Modulino *with* an MCU works this way; the four bare-sensor
ones (Distance, Thermo, Light, Movement) use their sensor's 7-bit address as-is.


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
| `0x02` | Latch Relay | yes |
| `0x1E` | **Buzzer** | yes |
| `0x24` | Motors | yes |
| `0x29` | Distance | **no** — VL53L4CD |
| `0x2C` | Joystick | yes |
| `0x36` | Pixels | yes |
| `0x38` | Vibro | yes |
| `0x39` | LED Matrix | yes |
| `0x3A` / `0x3B` | Knob | yes |
| `0x3E` | Buttons | yes |
| `0x44` | Thermo | **no** — HS3003 |
| `0x53` | Light | **no** — LTR-381RGB-01 |
| `0x6A` / `0x6B` | Movement | **no** — LSM6DSOX |

## Links

- [Product page](https://docs.arduino.cc/hardware/modulino-buzzer/) (ABX00108)
- [MicroPython library](https://github.com/arduino/arduino-modulino-mpy)
