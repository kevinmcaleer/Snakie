# ESP32 DevKit

An ESP32-WROOM-32 development board from Espressif with 2.4 GHz **Wi-Fi** and
**Bluetooth** built in. A great step up from a Pico when your project needs to
get online.

## Wiring

Key power pins:

| Pin | What it is |
|-----|------------|
| **VIN** | 5 V in (e.g. from USB) — the on-board regulator drops it to 3.3 V |
| **3V3** | 3.3 V out for sensors (the ESP32 runs at 2.3–3.6 V) |
| **GND** | ground (one on each side) |
| **EN** | enable / reset — pull low to reset the chip |

Handy GPIO groups:

- **ADC inputs**: IO32–IO36, IO39 (IO34/35/36/39 are **input-only** — no output, no pull-ups).
- **I2C** (common default): **IO21 = SDA**, **IO22 = SCL**.
- **SPI (VSPI)**: IO18 (SCK), IO19 (MISO), IO23 (MOSI), IO5 (CS).
- **UART0**: TX0 (GPIO 1) / RX0 (GPIO 3) — used by the USB REPL, leave free.
- **IO2** drives the on-board LED; PWM works on most IO pins.

## Quick start

```python
from machine import Pin
import time

led = Pin(2, Pin.OUT)     # on-board LED on GPIO 2
while True:
    led.value(not led.value())   # toggle
    time.sleep(0.5)
```

## Gotchas

- ⚠️ **3.3 V logic only** — 5 V on a GPIO will damage the chip. Power 5 V
  gear from VIN, but level-shift any signals coming back.
- ⚠️ **IO0 is the boot pin** — hold it low at reset to enter flashing mode;
  avoid parts that pull it low at power-up.
- ⚠️ **IO12 is a strapping pin** — if it's high at boot the board may fail to
  start; don't tie it high.
- Flash MicroPython with Snakie's **Flash firmware** button (pick the ESP32
  generic build); some boards need **IO0/BOOT** held while flashing starts.
