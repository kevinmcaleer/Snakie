# Adafruit Feather ESP32-S3

Adafruit's ESP32-S3 Feather (product 5323): a 3.3 V Wi-Fi + Bluetooth board with
USB-C, LiPo charging, a STEMMA QT connector, and an onboard NeoPixel.

## Wiring

Key pins (portrait, USB-C at the top):

| Pin | What it is |
|-----|------------|
| **3V** | 3.3 V out — power for sensors |
| **GND** | ground |
| **BAT** | LiPo battery voltage |
| **USB** | 5 V from the USB-C port |
| **EN** | pull low to switch off the 3.3 V regulator |
| **A0–A5** | analogue-capable GPIO (GP18, 17, 16, 15, 14, 8) |
| **D5–D13** | digital/PWM GPIO (GP5, 6, 9, 10, 11, 12, 13) |
| **SDA / SCL** | I2C bus 0 (GP3 / GP4) — same bus as the STEMMA QT socket |
| **SCK / MO / MI** | SPI (GP36 / GP35 / GP37) |
| **TX / RX** | UART (GP39 / GP38) |

The little red LED is on **GP13** (shared with pin D13). The NeoPixel is on
**GP33**, with its power switched by **GP21** — drive GP21 high first.

## Quick start

Blink the red LED and light the NeoPixel:

```python
from machine import Pin
import neopixel, time

led = Pin(13, Pin.OUT)                 # onboard red LED

Pin(21, Pin.OUT).value(1)              # enable NeoPixel power
np = neopixel.NeoPixel(Pin(33), 1)

while True:
    led.toggle()
    np[0] = (0, 16, 0) if led.value() else (16, 0, 0)
    np.write()
    time.sleep(0.5)
```

⚠️ Everything is **3.3 V only** — don't feed 5 V signals into any GPIO.

⚠️ The NeoPixel stays dark unless **GP21** (its power enable) is driven high.

⚠️ The ESP32-S3 has a flexible GPIO matrix, so SDA/SCL, SPI and TX/RX are the
board's *designated* pins — pass them explicitly, e.g.
`I2C(0, sda=Pin(3), scl=Pin(4))`.

To flash MicroPython, use Snakie's **Flash firmware** button with the
ESP32_GENERIC_S3 build (hold **BOOT** while tapping **RESET** if the board
isn't detected).
