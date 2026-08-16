# Modulino Distance

A **VL53L4CD** time-of-flight sensor on Arduino's I²C Modulino board. It bounces
invisible laser light off whatever is in front of it and times the return, which
makes it far tidier than an ultrasonic ranger — no cone of echo, no 40 kHz chirp,
and it works in silence.

## Address — this one is fixed

**`0x29`, and it cannot be changed.** There's no MCU on this board: the VL53L4CD
answers for itself, so the address is set in silicon. Two Distance modules
**cannot share a chain**.

That's the difference between the Modulinos with an onboard MCU (Buttons, Buzzer,
Knob, Pixels…) and the four bare-sensor ones (Distance, Thermo, Light, Movement).
If you need two, they go on separate buses — or behind a mux.

## Wiring

A QWIIC socket at **each end**, both on the same bus in parallel — plug the board
into either, and chain the next module off the other.

| Pin | What |
|---|---|
| GND | ground |
| 3V3 | 3.3 V |
| SDA | I²C data |
| SCL | I²C clock |

## Code

```python
from modulino import ModulinoDistance

distance = ModulinoDistance()

while True:
    print(distance.distance)     # centimetres, or None when out of range
```

`.distance` returns `None` rather than a number when nothing is in range — check
for it before comparing, or a stray `None` will crash the comparison:

```python
d = distance.distance
if d is not None and d < 10:
    print("something's close")
```

## Install the library

One package covers every Modulino, and it brings the `vl53l4cd` driver with it:

```python
mip.install("github:arduino/arduino-modulino-mpy")
```

Snakie offers this for you when you place a Modulino on the board — and only
once, however many Modulinos your design has.

## Modulino addresses

| Address | Module | Re-addressable? |
|---|---|---|
| `0x04` | Latch Relay | yes |
| `0x29` | **Distance** | **no** — VL53L4CD |
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
| `0x7C` | Buttons | yes |

## Links

- [Product page](https://docs.arduino.cc/hardware/modulino-distance/) (ABX00102)
- [MicroPython library](https://github.com/arduino/arduino-modulino-mpy)
