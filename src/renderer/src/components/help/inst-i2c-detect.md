The classic `i2cdetect` 8×16 address grid, as a one-shot dock probe.

## What it does
Pick the **BUS + SDA + SCL** from the connected board's valid I²C pins (invalid combos can't be chosen), then **SCAN** builds a `machine.I2C` on those pins, scans, and lights the responding addresses in the grid. The readout is **FOUND / SDA / SCL**.

## How to use it
Works on demand — no running program needed. It runs the probe over the device exec channel, roughly:

```python
from machine import I2C, Pin
b = I2C(0, sda=Pin(0), scl=Pin(1))
print(b.scan())   # -> responding addresses
```

Inside your own program you can emit the same set with `inst.i2c_scan(i2c)` (`SNK I2C …`). A lit cell means a device answered at that address.
