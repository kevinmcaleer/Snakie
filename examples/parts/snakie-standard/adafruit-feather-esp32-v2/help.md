# Adafruit ESP32 Feather V2

Adafruit's ESP32 Feather V2 (product 5400): a 3.3 V Wi-Fi + Bluetooth Classic/LE
board built on the **ESP32-PICO-MINI-02** (dual-core 240 MHz, 8MB flash, 2MB
PSRAM), with USB-C, LiPo charging, a STEMMA QT socket and an onboard NeoPixel.
Standard Feather footprint — 50.8 × 22.9 mm, 28 pads.

## Wiring

Portrait, USB-C at the top.

**Left edge — 16 pads:**

| Pin | What it is |
|-----|------------|
| **RST** | reset (pull low) |
| **3V** | 3.3 V out — power for sensors |
| **NC** | not connected |
| **GND** | ground |
| **A0–A5** | analogue in — GPIO **26, 25, 34, 39, 36, 4** |
| **SCK / MO / MI** | SPI — GPIO **5 / 19 / 21** |
| **RX / TX** | UART1 — GPIO **7 / 8** |
| **37** | GPIO 37 — analogue/digital **input only** |

**Right edge — 12 pads:**

| Pin | What it is |
|-----|------------|
| **BAT** | LiPo battery voltage (same net as the JST-PH `+`) |
| **EN** | pull low to switch off the 3.3 V regulator |
| **USB** | 5 V from the USB-C port |
| **13, 12, 27, 33, 15, 32, 14** | digital / PWM / analogue GPIO of the same number |
| **SCL / SDA** | I2C — GPIO **20 / 22**, the same bus as the STEMMA QT socket |

**Onboard:** NeoPixel on **GPIO 0**, red `#13` LED on **GPIO 13**, user button
`SW38` on **GPIO 38**, battery monitor on **GPIO 35** (A13) through a 2 × 200 kΩ
divider — so battery volts = `read * 2`.

## Quick start

```python
from machine import Pin, I2C, ADC
import neopixel, time

Pin(2, Pin.OUT).value(1)          # power the NeoPixel + STEMMA QT 3.3V rail
np = neopixel.NeoPixel(Pin(0), 1)
led = Pin(13, Pin.OUT)            # the red #13 LED
btn = Pin(38, Pin.IN)             # SW38 — input only, no internal pull-up

i2c = I2C(0, scl=Pin(20), sda=Pin(22))   # the STEMMA QT socket
print(i2c.scan())

vbat = ADC(Pin(35)); vbat.atten(ADC.ATTN_11DB)

while True:
    np[0] = (0, 30, 0) if btn.value() else (30, 0, 0); np.write()
    led.toggle()
    time.sleep(0.5)
```

## Gotchas

⚠️ **GPIO 2 gates the STEMMA QT power.** The same load switch feeds the NeoPixel
and the QT socket's 3.3 V pin. It is pulled high at boot, but drive it high
explicitly before talking to a QT device — and drive it low for the lowest
deep-sleep current.

⚠️ **GPIO 34, 36, 37, 39 are input-only** — no output, no PWM, and no internal
pull-up or pull-down. That covers **A2, A3, A4** and the **37** pad.

⚠️ **ADC2 pins stop working while Wi-Fi is on.** ADC2 covers **A0 (26), A1 (25),
A5 (4)** and **13, 12, 27, 15, 14**. If you need an analogue read with Wi-Fi
active, use an ADC1 pin: **A2 (34), A3 (39), A4 (36), 32, 33** or the **37** pad.

⚠️ **GPIO 12 is a boot strapping pin** — holding it high at reset changes the
flash voltage and can stop the board booting. Avoid pulling `D12` up.

⚠️ **Check LiPo polarity before you plug a battery in.** JST-PH leads are not
wired consistently between suppliers — match the **+** silk by the connector,
not the wire colours.

## Flashing MicroPython

No button-holding needed — the CP2102N USB-serial chip drives the reset and
bootloader lines, so the board enters the bootloader on its own. Use Snakie's
**Flash firmware** button with a generic **ESP32** MicroPython build. If
auto-reset ever fails, hold **RESET** as the flasher starts and let go when it
begins writing.

## Links

- [Product page](https://www.adafruit.com/product/5400)
- [Adafruit Learn guide](https://learn.adafruit.com/adafruit-esp32-feather-v2)
- [Arduino BSP pin definitions](https://github.com/espressif/arduino-esp32/blob/master/variants/adafruit_feather_esp32_v2/pins_arduino.h)
