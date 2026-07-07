# Raspberry Pi Pico 2 W

Raspberry Pi's RP2350 microcontroller board with a CYW43439 radio for 2.4 GHz
**Wi-Fi and Bluetooth LE**. The brain of your project — everything else in the
parts library wires into it.

## Wiring

The key pins (40-pin board, both edges castellated):

| Pin | What it's for |
|-----|---------------|
| **VBUS** (40) | 5 V straight from USB — power servos/motors here |
| **VSYS** (39) | Power the board from a battery (1.8–5.5 V in) |
| **3V3** (36) | 3.3 V out for sensors (keep the load light) |
| **GND** (3, 8, 13, 18, 23, 28, 33, 38) | Ground — share it with everything |
| **GP0–GP15** (left edge) | General GPIO — digital, PWM, I2C, SPI |
| **GP16–GP22** (right edge) | More GPIO — digital, PWM, I2C, SPI |
| **GP26 / GP27 / GP28** | The only **ADC** pins (ADC0/1/2) — analogue sensors go here |
| **RUN** (30) | Pull to GND to reset the board |

⚠️ All GPIO are **3.3 V only** — never feed 5 V into a GP pin. 5 V belongs on
VBUS/VSYS only.

## Quick start

Blink the onboard LED (it's on the wireless chip, so use the name `"LED"`):

```python
from machine import Pin
import time

led = Pin("LED", Pin.OUT)
while True:
    led.toggle()
    time.sleep(0.5)
```

## Flashing MicroPython

New board, or no REPL? Use Snakie's **Flash firmware** button — or hold
**BOOTSEL** while plugging in USB and drop the Pico 2 W `.uf2` onto the
`RP2350` drive. Make sure you grab the **Pico 2 W** firmware, not plain Pico 2 —
Wi-Fi and the LED won't work otherwise.

## Wi-Fi in one line (well, four)

```python
import network
wlan = network.WLAN(network.STA_IF)
wlan.active(True)
wlan.connect("your-ssid", "your-password")
```
