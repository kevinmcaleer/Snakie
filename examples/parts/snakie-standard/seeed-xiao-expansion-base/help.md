# Seeed XIAO Expansion Base

A carrier for the XIAO family: plug a XIAO into the socket and you get an OLED,
a real-time clock, a buzzer, a user button, a microSD slot and four Grove ports
with no soldering.

**58 × 42.5 mm.** The board is a *carrier*, not a microcontroller — it has no MCU
of its own. Drop a XIAO into the socket and the seated board's pins become this
board's pins (`D4` on the XIAO **is** `D4` here), which is how the Grove ports
below resolve to real GPIOs.

## What's on it

| Peripheral | Connection |
|---|---|
| 0.96" OLED (SSD1306) | I²C, address `0x3C` |
| RTC (PCF8563) | I²C, address `0x51`, CR1220 backup cell |
| Passive buzzer | `A3` (= `D3`) |
| User button | `D1` |
| microSD | SPI, CS on `D2` (SCK `D8`, MISO `D9`, MOSI `D10`) |
| Grove I²C ×2 | SCL `D5`, SDA `D4` |
| Grove UART ×1 | RX `D7`, TX `D6` |
| Grove analog/digital ×1 | `D0`, `D1` |

There is **no motor driver on this board** — that's a separate Grove module.

## Drivers you need

Only two of the onboard peripherals need anything installed. The part's **Works
with** list in the Parts panel installs each one on its own — nothing is pushed at
you, because most projects use only some of this board.

| Peripheral | Driver |
|---|---|
| OLED | **already works** — `inst.display` has a built-in SSD1306, or install `ssd1306` for the full driver |
| Buzzer | **already works** — `inst.buzzer`, or install `buzzer` for RTTTL melodies |
| User button | **nothing to install** — it's a `Pin` |
| RTC | install **`pcf8563`** |
| microSD | install **`sdcard`** |

The RTC is worth a warning: the PCF8563's seconds register shares its top bit with
a **voltage-low flag**, so a clock whose backup cell has gone flat doesn't run
slow — it reports nonsense. Check `rtc.unset()` before trusting a reading.

## Pin gotchas

Three collisions are worth knowing before you wire anything up:

- **The buzzer sits on `A3`, and on the XIAO RP2350 `A3`/`D3` is also the battery
  voltage sense (GPIO 29).** You can't beep and read the battery on the same
  pin. Seeed put a cuttable trace under the buzzer if you need `A3` back.
- **The user button is on `D1`, which is also the second pin of the Grove
  analog/digital port.** Plug a module into that port and it fights the button.
- `A3` and `D3` are the same physical GPIO — the two silk names refer to one pin.

## GPIO numbers

The Grove ports on this part are labelled with the **RP2040/RP2350 XIAO** GPIO
mapping, which is the same for both:

| Silk | GPIO | | Silk | GPIO |
|---|---|---|---|---|
| `D0` | GP26 | | `D6` | GP0 |
| `D1` | GP27 | | `D7` | GP1 |
| `D2` | GP28 | | `D8` | GP2 |
| `D3` | GP29 | | `D9` | GP4 |
| `D4` | GP6 (SDA) | | `D10` | GP3 |
| `D5` | GP7 (SCL) | | | |

So the I²C bus everything hangs off — OLED, RTC and both Grove I²C ports — is
**I²C1 on GP6/GP7**:

```python
from machine import Pin, I2C
i2c = I2C(1, sda=Pin(6), scl=Pin(7), freq=400_000)
print([hex(a) for a in i2c.scan()])   # 0x3c OLED, 0x51 RTC, + your modules
```

A XIAO with a different MCU (ESP32, nRF52840) keeps the same `D`/`A` silk names
but different GPIO numbers — the mount re-maps them when you seat that board
instead.

## Silk layout

The component positions here are representative rather than a copy of the
artwork: the four Grove ports are drawn along the bottom edge for legibility.
The **pin assignments are the real ones**, which is what matters for wiring.
