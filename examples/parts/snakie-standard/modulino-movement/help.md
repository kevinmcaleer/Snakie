# Modulino Movement

An **LSM6DSOX** six-axis IMU on Arduino's I²C Modulino board: a three-axis
accelerometer and a three-axis gyroscope in one chip. It tells you which way is
down, how fast the board is turning, and — with a bit of arithmetic — pitch and
roll.

## Address — `0x6A` or `0x6B`

There's no MCU on this board; the LSM6DSOX answers for itself, so the address is
set in silicon rather than in software. A **solder jumper** on the board picks
between the two, which is how you get two Movement modules on one chain — but it
means moving one is a soldering iron job, not a line of code.

The library tries both addresses in turn, so you don't normally have to say which
you have.

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
from modulino import ModulinoMovement

movement = ModulinoMovement()

while True:
    print(movement.acceleration)      # g, as .x / .y / .z
    print(movement.angular_velocity)  # degrees per second
```

Both properties return a named tuple, so you can pull one axis out or unpack all
three:

```python
a = movement.acceleration
print(a.z)

x, y, z = movement.angular_velocity
```

| Property | Returns |
|---|---|
| `.acceleration` | linear acceleration in **g**, X/Y/Z |
| `.angular_velocity` | rotation rate in **degrees per second**, X/Y/Z |
| `.acceleration_magnitude` | length of the acceleration vector — ≈ 1.0 at rest |
| `.angular_velocity_magnitude` | length of the rotation vector — ≈ 0 at rest |

### Is it level?

At rest the only acceleration is gravity, so `.acceleration_magnitude` reads
about **1.0 g**. That makes it an easy sanity check that the board is talking
sense before you trust anything else it says:

```python
from time import sleep

while True:
    a = movement.acceleration
    if abs(a.z - 1.0) < 0.05:
        print("flat")
    sleep(0.2)
```

Note the gyroscope measures **rate of turn**, not angle — hold the board still at
45° and it reads zero. Getting an angle out means integrating over time, and the
error accumulates; fusing it with the accelerometer is the usual answer.

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
from modulino import ModulinoMovement

# Use YOUR board's I²C pins — Snakie shows them on the board's pinout.
i2c = I2C(0, sda=Pin(4), scl=Pin(5))

movement = ModulinoMovement(i2c_bus=i2c)
```

Every Modulino class takes `i2c_bus`, so one bus serves a whole chain — build it
once and pass it to each module.

## Install the library

One package covers every Modulino, and it brings the `lsm6dsox` driver with it:

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
| `0x3A` / `0x3B` | Knob | yes |
| `0x3E` | Buttons | yes |
| `0x44` | Thermo | **no** — HS3003 |
| `0x53` | Light | **no** — LTR-381RGB-01 |
| `0x6A` / `0x6B` | **Movement** | solder jumper only |

## Links

- [Product page](https://docs.arduino.cc/hardware/modulino-movement/) (ABX00101)
- [MicroPython library](https://github.com/arduino/arduino-modulino-mpy)
