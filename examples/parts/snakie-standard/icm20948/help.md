---
kevsrobots: https://www.kevsrobots.com/learn/parts/icm20948/
example: icm20948_read.py
---
# ICM20948 9-DoF Motion Sensor

A Pimoroni breakout for the TDK InvenSense **ICM-20948** — a 3-axis
accelerometer, 3-axis gyroscope and 3-axis magnetometer (via an on-board
AK09916) in one tiny I²C package. Nine degrees of freedom for motion sensing,
tilt, orientation and compass heading. Runs at **3.3 V or 5 V**, so it's happy
on a Pico, an ESP32, or a Raspberry Pi.

## Wiring

| Pin | Connect to |
|------|-----------|
| **3-5V** | 3V3 (or 5V) |
| **GND** | GND |
| **SDA** | your I²C **SDA** GPIO |
| **SCL** | your I²C **SCL** GPIO |
| **INT** | *optional* — a GPIO, for the data-ready interrupt |

Default I²C address is **0x68** (**0x69** if you cut the address trace) — the
driver **auto-detects** either, so you don't have to pass one. The magnetometer
lives on the ICM-20948's internal aux bus at 0x0C — the driver reaches it for
you, so there's nothing extra to wire.

## Quick start

```python
from machine import I2C, Pin
from icm20948 import ICM20948
import time

i2c = I2C(0, sda=Pin(4), scl=Pin(5), freq=400_000)
imu = ICM20948(i2c)               # addr=0x69 if the address trace is cut

while True:
    ax, ay, az = imu.read_accel()  # g
    gx, gy, gz = imu.read_gyro()   # degrees / second
    mx, my, mz = imu.read_mag()    # microtesla (µT)
    print("accel g   ", ax, ay, az)
    print("gyro dps  ", gx, gy, gz)
    print("mag  uT   ", mx, my, mz)
    print("-")
    time.sleep(0.5)
```

## Live 3-D attitude (IMU instrument)

Hand the IMU to `inst.watch()` and the **IMU** instrument lights up with a live
3-D attitude view — roll/pitch from the accelerometer, heading from the mag. No
trig on your side:

```python
import instruments as inst
inst.start()
inst.watch(imu=imu)          # → the IMU instrument appears in the dock
while True:
    inst.update()            # streams orientation each loop
    time.sleep(0.05)
```

## API cheatsheet

```text
ICM20948(i2c, addr=0x68)            # 0x69 if the address trace is cut
read_accel()      -> (x, y, z)      # acceleration in g
read_gyro()       -> (x, y, z)      # angular rate in degrees/second
read_mag()        -> (x, y, z)      # magnetic field in microtesla (µT)
read_accel_gyro() -> (ax..az, gx..gz)   # both in one I²C burst
set_accel_full_scale(g=16)          # 2 / 4 / 8 / 16 g
set_gyro_full_scale(dps=250)        # 250 / 500 / 1000 / 2000 dps
who_am_i()        -> 0xEA           # health check
mag_supported                       # True if the AK09916 was found
```

## Notes

- The ICM-20948 pages its registers into four **user banks**; the driver
  switches banks automatically, so you just call the read methods.
- `read_mag()` reads the **continuously-streamed** AK09916 data (the driver sets
  it to 100 Hz and streams it into the ICM's registers via the aux-I²C master).
  If the magnetometer wasn't detected at start-up, `mag_supported` is `False`
  and `read_mag()` raises — accel + gyro keep working (6-DoF).
- A flat, still board reads roughly **1 g on the Z axis** and ~**0 dps** on the
  gyro — a quick sanity check that everything is wired up.
- **`OSError: [Errno 5] EIO`** — the driver tells the two cases apart:
  - *"not found at 0x68/0x69"* → nothing on the bus; check SDA/SCL/3V3/GND and
    `print(i2c.scan())` (the ICM shows as **104**/0x68 or **105**/0x69). Pass
    `Pin(...)` objects to `I2C(...)`, e.g. `I2C(0, sda=Pin(20), scl=Pin(21))`.
  - *"ACKs its address but every I2C transfer fails"* → the chip is seen (it
    ACKs, so `i2c.scan()` lists it) but the **bus can't clock data**: add
    **strong pull-ups** on SDA & SCL to 3V3, ensure a **solid common ground**,
    shorten wires, and re-seat SDA/SCL. On **RP2350** boards (e.g. the **Tiny
    2350**) use **~2.2 kΩ** pull-ups — erratum **RP2350-E9** adds a leaky ~8.2 kΩ
    internal pull-down that a 4.7 kΩ can't pull above a valid logic HIGH, so the
    bus ACKs but every read/write EIOs. A phantom **0x08** in `i2c.scan()`, or
    the *other* sensor failing too, confirms a bus (not chip) fault.
