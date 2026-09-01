# Pimoroni Pico LiPo 2

A Raspberry Pi Pico–shaped RP2350B board (PIM775) with **onboard LiPo charging**,
a **Qw/ST** (Qwiic / STEMMA QT) socket and 16MB flash + 8MB PSRAM. 51 × 21 mm,
40 castellated-and-through-hole pads, 26 GPIO broken out, **3.3 V** logic.

No radio on this one — if you need Wi-Fi, use the
**Pimoroni Pico LiPo 2 XL W** instead.

## Wiring

The 40 header pads are the **standard Pico pinout**, so Pico HATs and carriers
drop straight on:

| Edge (USB at the top) | Pads |
|---|---|
| **Left**, pin 1 → 20 | GP0, GP1, GND, GP2–GP5, GND, GP6–GP9, GND, GP10–GP13, GND, GP14, GP15 |
| **Right**, pin 40 → 21 | VBUS, VSYS, GND, 3V3_EN, 3V3, ADC_VREF, GP28, GND, GP27, GP26, RUN, GP22, GND, GP21–GP18, GND, GP17, GP16 |

**ADC**: GP26 / GP27 / GP28 = A0 / A1 / A2.

### Connectors

| Socket | What it is |
|---|---|
| **Qw/ST** | 4-pin JST-SH — GND · 3V3 · **SDA = GP4** · **SCL = GP5** (I2C0). Qwiic / STEMMA QT / Arduino Modulino cables plug straight in. |
| **LIPO** | 2-pin JST-PH for a 3.7 V single-cell LiPo. Charged over USB at ~215 mA (MCP73831) with XB6096I protection. |
| **DBUG** | 3-pin JST-SH debug — SWCLK · GND · SWDIO. |
| **SP/CE** | 8-pin JST-SH on the **underside** — GND · BL(GP36) · RX(GP32) · TX(GP35) · SCK(GP34) · CS(GP33) · 3V3 · VSYS. These five GPIO are *only* on this connector; they are not on the headers. |

## Quick start

```python
from machine import Pin, I2C
import time

led = Pin(25, Pin.OUT)                      # onboard user LED
boot = Pin(45, Pin.IN, Pin.PULL_UP)         # BOOT / USER button, active low

i2c = I2C(0, sda=Pin(4), scl=Pin(5))        # the Qw/ST socket
print(i2c.scan())

while True:
    led.toggle()
    if not boot.value():
        print('pressed')
    time.sleep(0.5)
```

## Flashing MicroPython

Hold **BOOT** while plugging in USB-C (or while tapping **RUN**) to get the
`RP2350` drive, then use Snakie's **Flash firmware** button. Pick **Pimoroni's
build for this board** — it is an RP2350**B** (48 GPIO), so a stock Raspberry Pi
Pico 2 build won't map the extra pins.

⚠️ Everything is **3.3 V** — GPIO are not 5 V tolerant. **VBUS** and **VSYS** are
5 V-ish rails, not logic pins.

⚠️ **Check LiPo polarity before you plug a battery in.** JST-PH leads are not
wired consistently between suppliers — match the **+** and **−** silk next to
the connector, not the wire colours.

## Links

- [Product page](https://shop.pimoroni.com/products/pimoroni-pico-lipo-2)
- [Pinout diagram (PDF)](https://cdn.shopify.com/s/files/1/0174/1800/files/ppico_lipo_2_pinout_diagram.pdf)
- [Schematic (PDF)](https://cdn.shopify.com/s/files/1/0174/1800/files/Pimoroni_Pico_LiPo_2_Schematic.pdf)
