# Raspberry Pi Pico W

The **Pico W** is Raspberry Pi's RP2040 microcontroller board with 2.4 GHz
wireless (Wi-Fi / Bluetooth via the CYW43439). It runs MicroPython brilliantly —
this is the "brain" you wire everything else to.

## Wiring (key pins)

| Pin | What it's for |
|-----|---------------|
| **VBUS** (40) | 5 V straight from USB — good for servos/LED strips |
| **VSYS** (39) | Power the board here (1.8–5.5 V) when not on USB |
| **3V3** (36) | 3.3 V out for sensors (regulated) |
| **GND** (3, 8, 13, 18, 23, 28, 33, 38) | Ground — every circuit needs one |
| **GP26 / GP27 / GP28** | The only **ADC** (analogue) pins — ADC0/1/2 |
| **GP0–GP15, GP16–GP22** | General GPIO — all do digital, PWM, I2C, SPI |
| **RUN** (30) | Pull to GND to reset the board |
| **3V3_EN** (37) | Pull low to switch off the 3.3 V regulator |

Handy defaults: **I2C0 = GP0 (SDA) / GP1 (SCL)**, **I2C1 = GP2 (SDA) / GP3 (SCL)**.
The onboard **LED** is on the wireless chip, so you address it as `"LED"`, not a
pin number.

## Quick start

```python
from machine import Pin
import time

led = Pin("LED", Pin.OUT)   # the onboard LED (via the Wi-Fi chip)
while True:
    led.toggle()
    time.sleep(0.5)
```

No MicroPython on it yet? Hold **BOOTSEL** while plugging in the USB cable, then
use Snakie's **Flash firmware** button — pick the **Pico W** build (the plain
Pico firmware won't drive the LED or Wi-Fi).

⚠️ GPIO pins are **3.3 V only** — connecting 5 V signals to a GPIO can kill the
RP2040. Level-shift anything 5 V.

⚠️ Powering heavy loads (servos, motors) from **3V3** will brown out the board —
take 5 V from **VBUS** instead and share GND.
