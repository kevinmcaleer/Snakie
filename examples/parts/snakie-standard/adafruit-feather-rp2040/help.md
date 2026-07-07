# Adafruit Feather RP2040

Adafruit's Feather-format RP2040 board with USB-C, a LiPo charger, a STEMMA QT
(I2C) connector and an onboard NeoPixel. Runs MicroPython at **3.3 V** logic.

## Wiring

Key power pins:

| Pin | What it is |
|-----|------------|
| **USB** | 5 V from the USB-C port |
| **BAT** | LiPo battery voltage (chargeable via USB) |
| **3.3V** | 3.3 V out from the regulator |
| **EN** | pull to GND to disable the 3.3 V regulator |
| **GND / RST** | ground / reset |

Notable GPIO groups (Feather label → RP2040 GPIO):

- **Analog**: A0–A3 → GP26–GP29 (the four ADC channels)
- **I2C (STEMMA QT)**: SDA → GP2, SCL → GP3 — bus **I2C1**
- **SPI**: SCK → GP18, MO → GP19, MI → GP20 — bus **SPI0**
- **UART**: TX → GP0, RX → GP1 — bus **UART0**
- **Digital**: D4–D13, D24, D25 — general-purpose, all PWM-capable
- **Onboard**: red LED on **GP13**, NeoPixel on **GP16**

## Quick start

```python
from machine import Pin
from neopixel import NeoPixel
import time

led = Pin(13, Pin.OUT)          # onboard red LED (D13)
px = NeoPixel(Pin(16), 1)       # onboard NeoPixel

while True:
    led.toggle()
    px[0] = (16, 0, 16) if led.value() else (0, 16, 0)
    px.write()
    time.sleep(0.5)
```

⚠️ It's a **3.3 V** board — don't feed 5 V signals into any GPIO.

⚠️ The STEMMA QT connector is **I2C1** (SDA = GP2, SCL = GP3), so use
`I2C(1, ...)`, not `I2C(0, ...)`.

To install MicroPython, hold **BOOTSEL** while plugging in USB (it mounts as a
drive), then use Snakie's **Flash firmware** button and pick the RP2040 build.
