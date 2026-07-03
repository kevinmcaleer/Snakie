An antique **aneroid barometer** — brass bezel, cream face, blued needle —
reading **temperature**, **barometric pressure** and **humidity** from an
environmental sensor like the BME280.

## What it shows
- The needle sweeps a classic **950–1050 hPa** scale with the old
  **RAIN · CHANGE · FAIR** legend; the plaque under the hub gives the exact hPa.
- **TEMP** (°C), **HUMIDITY** (%RH) and the **OUTLOOK** word read out below.
- **SRC** picks which reporting sensor channel to read (defaults to `env`).

## Feed it
Bind the sensor object and let the type drive the panel — or print readings
yourself:

```python
import time
import instruments as inst
from machine import I2C, Pin
from bme280 import BME280

i2c = I2C(0, sda=Pin(0), scl=Pin(1))
bme = BME280(i2c)
inst.start()
inst.watch(weather=bme)     # → SNK BIND weather env (lights up this barometer)
while True:
    inst.update()           # → SNK ENV weather <t> <p> <h>
    time.sleep(1)
```

Or emit one reading directly:

```python
t, p, h = bme.read()
inst.env(t, p, h)           # SNK ENV env <t> <p> <h>
```

## Tips
- Sea-level pressure is ~**1013 hPa**; a fast fall usually means weather is
  coming — exactly what the RAIN/CHANGE/FAIR legend is for.
- Any driver exposing `temperature`, `pressure` and `humidity` (or a
  `read()` returning all three) binds as an `env` sensor.
