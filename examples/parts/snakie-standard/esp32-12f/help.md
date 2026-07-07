# ESP32-12F

An Espressif **ESP32** module with Wi-Fi and Bluetooth built in — a 3.3 V
microcontroller you can run MicroPython on. Breadboard-friendly (2.54 mm pins),
with castellated edges and four mounting holes.

## Wiring

Key power pins (it's a **3.3 V** board):

| Pin | Purpose |
|-----|---------|
| **VCC / 3v3** | 3.3 V power in — top-right VCC, plus 3v3 pins on both edges |
| **GND** | Ground — several, on both edges |
| **EN** | Chip enable — must be **high** for the chip to run |
| **RST** | Reset |

Notable GPIO groups (from the part's pinout):

- **D0–D8** — general digital I/O (GPIO 0, 1, 4, 5, 6, 11–14); **d0** also does PWM.
- **RX / TX** (GPIO 15 / 16) — UART, also used for the REPL/serial link.
- **CLK / CMD / SD0–SD3** (GPIO 21–26) — the SD/flash bus group; avoid these for
  general I/O.
- **A0** (GPIO 29) — analogue-capable pin.
- **RSV** pins are reserved — leave them unconnected.

## Quick start

```python
from machine import Pin
import time

led = Pin(0, Pin.OUT)      # d0
while True:
    led.value(not led.value())
    time.sleep(0.5)
```

⚠️ **3.3 V only** — the GPIO pins are not 5 V tolerant; use a level shifter for
5 V sensors.

⚠️ **GPIO 0 is a boot-strap pin** — if it's held **low** at reset the chip enters
flashing mode, so don't tie d0 to GND.

⚠️ Bare modules have **no USB-serial chip** — you'll need a USB-UART adapter on
RX/TX (with EN pulled high) to flash MicroPython and talk to the REPL.
