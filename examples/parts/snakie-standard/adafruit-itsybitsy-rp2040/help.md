# Adafruit ItsyBitsy RP2040

A tiny **RP2040** board in Adafruit's ItsyBitsy form factor — micro-USB, an
onboard red LED on **D13** (GP11) and a **NeoPixel** on GP17 (its power switched
by GP16). Runs at **3.3 V** logic.

## Wiring

Key power pins (micro-USB at the top):

| Pin | What it is |
|-----|------------|
| **BAT** | Battery input (feeds the regulator) |
| **USB** | 5 V from the USB port |
| **VHi** | The higher of BAT/USB — good for powering 5 V-ish loads |
| **3.3V** | Regulated 3.3 V out |
| **G** | Ground |
| **RST** | Reset |

Notable GPIO groups:

- **A0–A3** (GP26–GP29) — the four **ADC** channels (ADC0–3), also digital/PWM.
- **SDA / SCL** (GP2 / GP3) — the labelled **I2C** pair (bus 1).
- **SCK / MO / MI** (GP18 / GP19 / GP20) — the labelled **SPI** pins (bus 0).
- **TX / RX** (GP0 / GP1) — **UART 0**.
- **D2–D5, D7, D9–D13, D24, D25** — general digital/PWM pins.

Note: the **D-numbers on the silkscreen are not the GP numbers** — e.g. D13 is
GP11, D5 is GP14. MicroPython wants the GP number.

## Quick start

```python
from machine import Pin
import time

led = Pin(11, Pin.OUT)      # onboard red LED (silkscreen D13)
while True:
    led.toggle()
    time.sleep(0.5)
```

⚠️ It's a **3.3 V** board — don't feed 5 V into any GPIO. ⚠️ The NeoPixel needs
GP16 driven **high** to power it before you write to GP17.

To install MicroPython: hold **BOOTSEL** while plugging in USB (it mounts as a
drive), then use Snakie's **Flash firmware** button.
