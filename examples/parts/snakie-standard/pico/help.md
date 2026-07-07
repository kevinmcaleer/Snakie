# Raspberry Pi Pico

Raspberry Pi's **RP2040** microcontroller board — a dual-core Arm chip on a 40-pin
board (same header layout as the Pico W / 2 W). Runs MicroPython beautifully.

## Wiring

Key power pins (right edge):

| Pin | What it is |
|-----|------------|
| **VBUS** (40) | 5 V straight from USB |
| **VSYS** (39) | power the Pico here (1.8–5.5 V) when not on USB |
| **3V3** (36) | 3.3 V out for sensors (keep it under ~300 mA) |
| **GND** | eight ground pins spread along both edges |

Notable GPIO groups:

- **GP0–GP15** down the left edge, **GP16–GP22** up the right — all do digital,
  PWM, I2C and SPI.
- **GP26 / GP27 / GP28** — the only three **ADC** channels (ADC0–2), for pots
  and analogue sensors. **ADC_VREF** (35) sets their reference.
- **I2C0** default pins: GP0 (SDA) / GP1 (SCL). **I2C1**: GP2 (SDA) / GP3 (SCL).
- The onboard **LED** is on **pin 25**.
- **RUN** (30) — short to GND to reset the board.

## Quick start

```python
from machine import Pin
import time

led = Pin(25, Pin.OUT)   # onboard LED
while True:
    led.toggle()
    time.sleep(0.5)
```

## Flashing MicroPython

Hold **BOOTSEL** while plugging in the USB cable and the Pico mounts as a USB
drive — or just use Snakie's **Flash firmware** button, which does it for you.

⚠️ GPIO pins are **3.3 V only** — 5 V on a GPIO will damage the RP2040. 5 V
sensors need a level shifter (or wire them to VBUS for power and check their
signal levels).
