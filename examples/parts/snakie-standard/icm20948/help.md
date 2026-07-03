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

Default I²C address is **0x68** (**0x69** if you cut the address trace). The
magnetometer lives on the ICM-20948's internal aux bus at 0x0C — the driver
reaches it for you, so there's nothing extra to wire.

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
- `read_mag()` triggers a **single-shot** measurement and waits for data-ready.
  If the magnetometer wasn't detected at start-up, `mag_supported` is `False`
  and `read_mag()` raises — accel + gyro keep working (6-DoF).
- A flat, still board reads roughly **1 g on the Z axis** and ~**0 dps** on the
  gyro — a quick sanity check that everything is wired up.
