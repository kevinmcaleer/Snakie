# Adafruit Feather nRF52840 Express

A 3.3 V Feather board built on the Nordic **nRF52840** — Bluetooth Low Energy,
native USB, LiPo charging, and an onboard NeoPixel. Great for wireless sensors
and battery-powered projects.

## Wiring

Key pins (portrait, USB at the top):

| Pin | What it is |
|-----|------------|
| **3V** | 3.3 V out from the regulator |
| **GND** | ground |
| **VBAT** | LiPo battery voltage (JST connector) |
| **VBUS** | 5 V from USB — for powering **5 V loads**, not logic |
| **EN** | pull to GND to switch the 3.3 V regulator off |
| **A0–A5** | analogue inputs (ADC), also digital/PWM |
| **SCL / SDA** | I2C (GPIO 11 / 12) |
| **SCK / MO / MI** | SPI (GPIO 14 / 13 / 15) |
| **TX / RX** | UART (GPIO 25 / 24) |
| **D2, D5–D13** | general digital/PWM pins |

Pin names map to nRF ports: `P0.n` → GPIO `n`, `P1.n` → GPIO `32 + n`
(so **D13** = P1.09 = GPIO 41).

## Quick start

Blink the red user LED (P1.15 = GPIO 47):

```python
from machine import Pin
import time

led = Pin(47, Pin.OUT)     # red user LED
while True:
    led.toggle()
    time.sleep(0.5)
```

The onboard **NeoPixel** is on GPIO 16 — drive GPIO 46 **high** first to power it.

⚠️ This is a **3.3 V** board — its GPIO pins are *not* 5 V tolerant. Use VBUS
only as a 5 V supply rail, never into a GPIO.

⚠️ MicroPython isn't pre-installed: double-tap **RESET** for the UF2 bootloader
and copy a MicroPython UF2 for the Feather nRF52840 onto the drive that appears.
