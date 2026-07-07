---
---
# Adafruit QT Py RP2040

A thumb-sized RP2040 board with USB-C, castellated pads, a STEMMA QT connector
and an onboard NeoPixel. Runs MicroPython — same chip as the Pico, just tiny.

## Wiring

Only 14 pads, and most do double duty:

| Pad(s) | What they are |
|--------|---------------|
| **5V / GND / 3V** | Power — 5 V in from USB, 3.3 V out (logic is **3V3**) |
| **A0–A3** (GP29/28/27/26) | Analogue inputs (ADC3–ADC0), also digital/PWM |
| **SDA / SCL** (GP24/25) | I2C0 on the pads |
| **MOSI / MISO / SCK** (GP3/4/6) | SPI0 |
| **TX / RX** (GP20/5) | UART1 |
| **STEMMA QT** | Plug-and-play **I2C1** (SDA1=GP22, SCL1=GP23) |

## Quick start

Blink the onboard NeoPixel (GP12 — you must power it via GP11 first):

```python
from machine import Pin
from neopixel import NeoPixel
import time

Pin(11, Pin.OUT, value=1)        # NeoPixel power enable
px = NeoPixel(Pin(12), 1)
while True:
    px[0] = (16, 0, 16); px.write()
    time.sleep(0.5)
    px[0] = (0, 0, 0); px.write()
    time.sleep(0.5)
```

⚠️ There's **no plain user LED** — the NeoPixel on GP12 is it, and it stays dark
until you drive **GP11 high**.

⚠️ Everything is **3.3 V logic**; the 5V pad is USB power in/out only.

⚠️ The STEMMA QT port is **I2C1**, not I2C0 — use
`I2C(1, sda=Pin(22), scl=Pin(23))` for plug-in sensors.

To flash MicroPython: hold **BOOT**, tap **RESET** (it appears as a USB drive),
then use Snakie's **Flash firmware** button.
