# Pimoroni Tiny 2350

A postage-stamp RP2350 board (PIM721) with USB-C, an onboard RGB LED and
castellated edges — solder it flat onto your own PCB or use it on a breadboard.
16 pads, 8 per edge, running MicroPython at **3.3 V** logic.

## Wiring

**Left edge** (USB at the top):

| Pin | What it is |
|-----|------------|
| 5V | power in/out (from USB-C) |
| GND | ground (×2 — top and bottom of the edge) |
| 3V3 | 3.3 V out for sensors |
| A3–A0 | **GP29–GP26** — the four ADC-capable GPIOs (also digital, PWM, I2C, SPI, UART) |

**Right edge**: **GP0–GP7** — general-purpose GPIO (digital, PWM, I2C, SPI, UART).

## Quick start

```python
from machine import ADC, Pin
import time

led = Pin(0, Pin.OUT)     # something on GP0
pot = ADC(Pin(26))        # analogue input on A0 (GP26)

while True:
    led.toggle()
    print(pot.read_u16())  # 0 … 65535
    time.sleep(0.5)
```

## Flashing MicroPython

Hold the **BOOT** button while plugging in the USB-C cable (or while tapping
**RST**) to enter bootloader mode, then use Snakie's **Flash firmware** button
and pick an RP2350 (Pico 2 family) MicroPython build.

⚠️ Everything here is **3.3 V** — don't feed 5 V signals into any GPIO. The
**5V** pad is fine as a power input, but logic pins are not 5 V tolerant.

⚠️ Only **A0–A3** (GP26–GP29) can read analogue voltages — the GP0–GP7 edge
is digital-only (with PWM, I2C, SPI and UART available on every pin).
