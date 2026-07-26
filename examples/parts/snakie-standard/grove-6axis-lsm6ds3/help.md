# Grove 6-Axis Accelerometer & Gyroscope

An **LSM6DS3** — 3-axis accelerometer plus 3-axis gyroscope — on a Grove I²C
module. Plug it into any Grove **I²C** port.

## Address

The silk says `0x6A`, which is the address with `SA0` low. Most units ship with
`SA0` pulled **high**, so they answer on **`0x6B`**. Check both.

`WHO_AM_I` (register `0x0F`) returns **`0x69`** on a healthy LSM6DS3. If the
device ACKs its address but `WHO_AM_I` reads `0xFF`, that's a marginal Grove
cable, not a dead sensor — reseat it.

```python
from machine import Pin, I2C
i2c = I2C(1, sda=Pin(6), scl=Pin(7), freq=400_000)

addr = next((a for a in (0x6B, 0x6A) if a in i2c.scan()), None)
print("IMU at", hex(addr), "who_am_i", hex(i2c.readfrom_mem(addr, 0x0F, 1)[0]))
```

## Reading it

The sensor powers up asleep — you must set an output data rate before either
sensor returns anything but zeros.

```python
i2c.writeto_mem(addr, 0x10, b"\x40")   # CTRL1_XL: accel 104 Hz, +/-2 g
i2c.writeto_mem(addr, 0x11, b"\x40")   # CTRL2_G:  gyro  104 Hz, 245 dps

def s16(lo, hi):
    v = lo | (hi << 8)
    return v - 65536 if v & 0x8000 else v

d = i2c.readfrom_mem(addr, 0x28, 6)    # OUTX_L_XL .. OUTZ_H_XL
ax, ay, az = (s16(d[i], d[i + 1]) * 0.000061 for i in (0, 2, 4))   # g
g = i2c.readfrom_mem(addr, 0x22, 6)    # OUTX_L_G .. OUTZ_H_G
gx, gy, gz = (s16(g[i], g[i + 1]) * 0.00875 for i in (0, 2, 4))    # dps
```

Scale factors are for the ranges set above: **0.061 mg/LSB** at ±2 g and
**8.75 mdps/LSB** at 245 dps. Change the range and the factor changes with it.

## Gyro drift

The gyro has a constant bias — leave the board still and it will still report a
few tenths of a degree per second. Average a few hundred samples at startup while
the robot is stationary and subtract that offset, or any heading you integrate
will wander.
