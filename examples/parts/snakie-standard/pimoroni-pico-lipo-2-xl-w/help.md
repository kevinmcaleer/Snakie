# Pimoroni Pico LiPo 2 XL W

A stretched RP2350B board (PIM776) with **2.4 GHz Wi-Fi + Bluetooth** (Raspberry
Pi RM2 module), **onboard LiPo charging**, a **Qw/ST** (Qwiic / STEMMA QT) socket,
16MB flash and 8MB PSRAM. 76.4 × 21 mm, 60 pads, **40 GPIO** broken out,
**3.3 V** logic.

The three-in-one board for battery-powered I2C projects: Wi-Fi, a Qwiic chain and
a JST-PH battery all on one stick.

## Wiring

The first 20 pads of each edge are the **standard Pico pinout**; the XL then adds
ten more per edge:

| Edge (USB at the top) | Pads |
|---|---|
| **Left**, pin 1 → 30 | GP0, GP1, GND, GP2–GP5, GND, GP6–GP9, GND, GP10–GP13, GND, GP14, GP15, **3V3, GP31, GND, GP32–GP35, GND, GP36, GP37** |
| **Right**, pin 60 → 31 | VBUS, VSYS, GND, 3V3_EN, 3V3, ADC_VREF, GP28, GND, GP27, GP26, RUN, GP22, GND, GP21–GP18, GND, GP17, GP16, **BOOT(GP30), GP47, GND, GP46, GP45, GP44, GP43, GND, GP39, GP38** |

**ADC**: GP26/27/28 = A0/A1/A2 and GP43–GP47 = A3–A7 (eight analogue inputs).
**HSTX**: GP12–GP19.

### Connectors

| Socket | What it is |
|---|---|
| **Qw/ST** | 4-pin JST-SH — GND · 3V3 · **SDA = GP4** · **SCL = GP5** (I2C0). Qwiic / STEMMA QT / Arduino Modulino cables plug straight in. |
| **LIPO** | 2-pin JST-PH for a 3.7 V single-cell LiPo. Charged over USB at ~215 mA (MCP73831) with XB6096I protection. |
| **DBUG** | 3-pin JST-SH debug — SWCLK · GND · SWDIO. |
| **SP/CE** | 8-pin JST-SH — GND · BL(GP36) · RX(GP32) · TX(GP35) · SCK(GP34) · CS(GP33) · 3V3 · VSYS. Shares its nets with those same pads on the left header. |

## Quick start

```python
from machine import Pin, I2C
import network, time

led = Pin('LED', Pin.OUT)                   # user LED — it hangs off the RM2's
                                            # WL_GPIO0, not a numbered GPIO
boot = Pin(30, Pin.IN, Pin.PULL_UP)         # BOOT / USER button, active low

i2c = I2C(0, sda=Pin(4), scl=Pin(5))        # the Qw/ST socket
print(i2c.scan())

wlan = network.WLAN(network.STA_IF)
wlan.active(True)
wlan.connect('ssid', 'password')
while not wlan.isconnected():
    led.toggle()
    time.sleep(0.5)
print(wlan.ifconfig())
```

## Flashing MicroPython

Hold **BOOT** while plugging in USB-C (or while tapping **RUN**) to get the
`RP2350` drive, then use Snakie's **Flash firmware** button. Pick **Pimoroni's
build for this board** — it is an RP2350**B** (48 GPIO) with an RM2 radio, so a
stock Raspberry Pi Pico 2 / Pico 2 W build won't map the extra pins.

⚠️ Everything is **3.3 V** — GPIO are not 5 V tolerant. **VBUS** and **VSYS** are
5 V-ish rails, not logic pins.

⚠️ **Check LiPo polarity before you plug a battery in.** JST-PH leads are not
wired consistently between suppliers — match the **+** and **−** silk next to
the connector, not the wire colours.

⚠️ Two of the broken-out pads are **already in use** and need a solder-bridge cut
before you can use them as GPIO:

- **GP43** is the battery-voltage sense — cut **“BtS”** to free it.
- **GP47** is the PSRAM chip-select — cut **“PSRAM”** to free it (you lose the
  8MB PSRAM).

## Links

- [Product page](https://shop.pimoroni.com/products/pimoroni-pico-lipo-2-xl-w)
- [Pinout diagram (PDF)](https://cdn.shopify.com/s/files/1/0174/1800/files/ppico_lipo_2_xl_w_pinout_diagram.pdf)
- [Schematic (PDF)](https://cdn.shopify.com/s/files/1/0174/1800/files/Pimoroni_Pico_LiPo_2_XL_W_Schematic.pdf)
