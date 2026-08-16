# Modulino Motors

A **MAX22211 dual H-bridge** on Arduino's I²C Modulino board: two brushed DC
motors, one bipolar stepper, or a couple of solenoids — up to **3.8 A per
channel**, with current sensing on both.

## Address

**`0x24`.** There's an MCU on this board rather than a bare driver chip, so the
address is **re-addressable** and two Motors modules can share a chain.

The MicroPython library lists this module as `0x48` — that's the **8-bit**
form. The firmware answers on `0x48 >> 1` = **`0x24`**, which is what a bus
scan reports. Every Modulino *with* an MCU works this way; the four bare-sensor
ones (Distance, Thermo, Light, Movement) use their sensor's 7-bit address as-is.


## Power — this one needs its own supply

Logic runs at 3.3 V over QWIIC, but the motors do **not**: give `VIN` a separate
**5–24 V** supply sized for your motors. The two positive rails stay isolated;
the grounds are common, which is why `GND` on the screw terminal is the same net
as QWIIC ground in the Board View.

> Don't try to run motors off the QWIIC 3V3 — it can't source it, and a stalled
> motor pulling 3.8 A through a QWIIC cable is a fire, not a brownout.

| Terminal | What |
|---|---|
| VIN / GND | motor supply, 5–24 V |
| A1 / A2 | motor A |
| B1 / B2 | motor B |

For a **stepper**, one coil goes to A1/A2 and the other to B1/B2.

## Code

```python
from modulino import ModulinoMotors

motors = ModulinoMotors()

motors.speed_a = 60          # 0–100 %
motors.speed_b = 60
motors.invert_b = True       # opposite side of a rover drives backwards

print(motors.sensed_current)  # (mA, mA) — a stalled motor shows up here

motors.stop()                 # brake
motors.release()              # coast
```

As a stepper:

```python
motors.stepper_mode_enabled = True
motors.steps_per_revolution = 200
motors.move_stepper_rpm(400, rpm=60)   # two turns at 60 rpm
```

## The Motor instrument

Snakie's **Motor** panel doesn't drive this board yet. The panel speaks signed
powers (`-1.0`…`1.0`) to a driver exposing `drive(a, b)` / `stop_all()` /
`brake()` / `standby()`, which is the bundled `tb6612` module's shape;
`ModulinoMotors` instead exposes unsigned `speed_a`/`speed_b` (0–100) plus
`invert_a`/`invert_b`. A small adapter bridges the two — tracked separately.

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
| `0x1E` | Buzzer | yes |
| `0x24` | **Motors** | yes |
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

The **no** rows have no onboard MCU: the sensor chip answers directly, so its
address is fixed in silicon and two of that module can't share a chain.

## Links

- [Product page](https://docs.arduino.cc/hardware/modulino-motors/) (ABX00114)
- [MicroPython library](https://github.com/arduino/arduino-modulino-mpy)
