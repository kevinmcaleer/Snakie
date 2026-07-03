---
kevsrobots: https://www.kevsrobots.com/learn/parts/bme280/
example: bme280_read.py
---
# BME280 Breakout

The **BME280** is a Bosch environmental sensor that measures **temperature**,
**barometric pressure** and **relative humidity** in one tiny chip. This Pimoroni
breakout talks **I²C** at address **0x76** (or **0x77** if you cut/bridge the
**ADDR** trace) and runs happily on 2–6 V, so it wires straight to a Pico, ESP32
or any I²C-capable board — over the 0.1" header or the Qw/ST (Qwiic / STEMMA QT)
socket.

## Wiring

| Pin | Connect to |
|-----|------------|
| **2-6V** | 3V3 (2–6 V power in) |
| **SDA** | a GPIO SDA (Pico I2C0: **GP0**) |
| **SCL** | a GPIO SCL (Pico I2C0: **GP1**) |
| **INT** | leave unconnected |
| **GND** | GND |

## Quick start

```python
from machine import I2C, Pin
from bme280 import BME280
import time

i2c = I2C(0, sda=Pin(0), scl=Pin(1))   # Pico I2C0: SDA=GP0, SCL=GP1
bme = BME280(i2c)                       # Pimoroni default address 0x76

while True:
    temp, pressure, humidity = bme.read()
    print("Temperature: {:.1f} C".format(temp))
    print("Pressure:    {:.1f} hPa".format(pressure))
    print("Humidity:    {:.1f} %RH".format(humidity))
    print("-" * 24)
    time.sleep(1)
```

If `BME280(i2c)` raises `OSError: BME280 not found…`, the sensor isn't answering
at 0x76 — try `BME280(i2c, addr=0x77)`, or run an I²C scan (`i2c.scan()`) to see
what address it's on.

## API cheatsheet

```text
BME280(i2c, addr=0x76)      one sensor on an I2C bus (0x76 default, 0x77 alt)
read()                      -> (temperature °C, pressure hPa, humidity %RH)
.temperature                property, °C
.pressure                   property, hPa
.pressure_pa                property, Pa
.humidity                   property, %RH
```

## Notes

- **Pressure units**: `read()` and `.pressure` return **hPa** (1 hPa = 100 Pa =
  1 mbar); use `.pressure_pa` for raw pascals. Sea-level pressure is ~1013 hPa.
- The compensation maths follows the **Bosch BME280 datasheet**
  (BST-BME280-DS002) — the driver reads each sensor's own factory calibration,
  so readings are per-unit accurate out of the box.
- Self-heating: leave a second or two between reads (or lower the sample rate)
  if you want the most accurate ambient temperature.
