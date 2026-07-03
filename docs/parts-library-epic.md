# Epic: Standard Parts Library expansion

Grow the Snakie **Standard library** beyond microcontroller boards to the full
range of hobby-electronics parts — sensors, displays, driver ICs, motor drivers,
comms modules — so a user can drag a real part onto the Board View, wire it, and
get working MicroPython.

Source of truth for *what exists and is well-supported*: the **Adafruit
CircuitPython driver bundle** ([drivers list](https://docs.circuitpython.org/projects/bundle/en/latest/drivers.html)) —
~380 driver libraries, already grouped into hardware categories. These are
CircuitPython drivers, but the underlying parts are standard I²C/SPI/UART chips
that work with MicroPython (often with an existing MP driver; sometimes a port).

> Supersedes the seed list in [`common-parts.md`](common-parts.md) (#199). The
> [build-part-from-image skill](../.claude/skills/build-part-from-image/SKILL.md)
> generates each part.

## Definition of done — every part ships THREE things

1. **The part** — `parts.yml` + a real board image, with the correct `family`
   (+ sub-category in `tags`), verified pinout, and `signals`/`buses`.
2. **A mini-help article** — `help.md` in the part folder: what it is, how to wire
   it (part pin → board pin), a minimal MicroPython snippet, the driver install
   line, and links (datasheet, CircuitPython driver, MicroPython driver).
3. **A driver** — the part's `library` (import module + `mip`/git URL + docs) and/or
   `drivers` (files to install on the board). Prefer an existing MicroPython driver;
   if only a CircuitPython driver exists, link it and flag **“port needed”**.

## Category taxonomy (CircuitPython section → Snakie family + sub-category)

Ten top-level families (the Board View section headers, #193) with **sub-categories**
via `tags` for the big ones. Counts are the bundle's driver count for scale.

| CircuitPython section | ~n | Snakie `family` | Sub-category tag |
|-----------------------|---:|-----------------|------------------|
| Environmental Sensors | 51 | `Sensor` | `env` (temp/humidity/pressure/gas/thermocouple) |
| Motion Sensors | 30 | `Sensor` | `imu` (accel/gyro/mag/hall/angle) |
| Light Sensors | 25 | `Sensor` | `light` (ambient/colour/UV/proximity/gesture) |
| Distance Sensors | 9 | `Sensor` | `distance` (ToF/ultrasonic/LiDAR) |
| Color TFT-LCD | 7 | `Display` | `tft` |
| OLED | 11 | `Display` | `oled` |
| E-Paper / E-Ink | 18 | `Display` | `epaper` |
| Displays → Other | 11 | `Display` | `segment` / `matrix` / `touch` / `lcd` |
| Real-time clocks | 4 | `IC` | `rtc` |
| IO Expansion | 32 | `IC` | `gpio-expander` / `adc` / `dac` / `pwm-driver` / `mux` / `touch` |
| Motor Helpers | 5 | `Motor` | `driver` / `servo` / `stepper` / `fan` |
| Blinky (LED) | 8 | `Output` | `addressable-led` |
| Audio Helpers | 5 | `Output` | `audio` |
| Radio | 8 | `Communication` | `wifi` / `ble` / `lora` / `nfc` |
| Miscellaneous | 51 | (mixed) | current→`Power`, memory→`IC`, keypad/touch→`Input`, camera→`Sensor`, GPS/cellular/ethernet→`Communication` |

> **Library housekeeping:** normalise off-taxonomy families already in the lib
> (e.g. `Breakout` → the right family). Every part gets one of the ten families.

## Wishlist by category (curated — the common ones first)

Priority: **P0** = ship first (ubiquitous in hobby builds), **P1** = common, **P2** = nice-to-have.
`CP` = CircuitPython module; `MP` = MicroPython driver status.

### Sensor · Environment
| Part | Bus | CP | MP | Pri |
|------|-----|----|----|----|
| BME280 (T/H/P) | I²C/SPI | `adafruit_bme280` | yes (robert-hh) | P0 |
| BME680 (T/H/P/gas) | I²C/SPI | `adafruit_bme680` | yes | P1 |
| BMP280 (P/T) | I²C/SPI | `adafruit_bmp280` | yes | P1 |
| DHT22 / DHT11 (T/H) | 1-wire | `adafruit_dht` | built-in (`dht`) | P0 |
| DS18B20 (T) | 1-wire | `adafruit_ds18x20` | built-in (`ds18x20`) | P0 |
| SHT31 / SHT4x (T/H) | I²C | `adafruit_sht31d` | yes | P1 |
| AHT20 (T/H) | I²C | `adafruit_ahtx0` | yes | P1 |
| SCD40/41 (CO₂) | I²C | `adafruit_scd4x` | yes | P1 |
| MLX90614 (IR temp) | I²C | `adafruit_mlx90614` | yes | P2 |
| MAX31855/65 (thermocouple/RTD) | SPI | `adafruit_max318xx` | yes | P2 |

### Sensor · Motion / IMU
| Part | Bus | CP | MP | Pri |
|------|-----|----|----|----|
| MPU-6050 (6-DoF) | I²C | `adafruit_mpu6050` | yes | P0 |
| MPU-9250 / ICM-20948 (9-DoF) | I²C | `adafruit_icm20x` | yes | P1 |
| BNO055 / BNO085 (fusion IMU) | I²C/UART | `adafruit_bno055/08x` | partial (port) | P1 |
| LSM6DS3/DSOX (6-DoF) | I²C | `adafruit_lsm6dsox` | yes | P1 |
| ADXL345 (accel) | I²C/SPI | `adafruit_adxl34x` | yes | P1 |
| LIS3DH (accel) | I²C/SPI | `adafruit_lis3dh` | yes | P2 |
| AS5600 (magnetic angle) | I²C | `adafruit_as5600` | yes | P2 |

### Sensor · Light / Colour
| Part | Bus | CP | MP | Pri |
|------|-----|----|----|----|
| TCS34725 (RGB colour) | I²C | `adafruit_tcs34725` | yes | P0 |
| VEML7700 (ambient lux) | I²C | `adafruit_veml7700` | yes | P1 |
| BH1750 (lux) | I²C | `adafruit_bh1750` | yes | P1 |
| APDS9960 (gesture/prox/RGB) | I²C | `adafruit_apds9960` | yes | P1 |
| TSL2591 (high-range lux) | I²C | `adafruit_tsl2591` | yes | P2 |
| LTR390 (UV + ambient) | I²C | `adafruit_ltr390` | yes | P2 |

### Sensor · Distance / ToF
| Part | Bus | CP | MP | Pri |
|------|-----|----|----|----|
| HC-SR04 (ultrasonic) | digital | `adafruit_hcsr04` | trivial (shipped) | P0 |
| VL53L0X (ToF ~1 m) | I²C | `adafruit_vl53l0x` | yes | P0 |
| VL53L1X (ToF ~4 m) | I²C | `adafruit_vl53l1x` | yes | P1 |
| VL6180X (ToF ~10 cm + lux) | I²C | `adafruit_vl6180x` | yes | P2 |

### Display · TFT / OLED / E-Paper / Segment
| Part | Bus | CP | MP | Pri |
|------|-----|----|----|----|
| SSD1306 OLED (128×64) | I²C/SPI | `adafruit_ssd1306` | built-in (`ssd1306`) | P0 |
| SH1106 OLED | I²C/SPI | `adafruit_displayio_sh1106` | yes | P1 |
| ST7789 TFT (240×240/320) | SPI | `adafruit_st7789` | yes | P0 |
| ILI9341 TFT (320×240) | SPI | `adafruit_ili9341` | yes | P1 |
| ST7735 TFT (160×128) | SPI | `adafruit_st7735r` | yes | P1 |
| GC9A01A round TFT (240×240) | SPI | `adafruit_gc9a01a` | yes | P1 |
| **HX8357 TFT (480×320)** | SPI | `adafruit_hx8357` | port needed | P1 — *worked example* |
| SSD1680 E-Paper | SPI | `adafruit_ssd1680` | partial | P2 |
| HT16K33 (7-seg / 8×8 matrix) | I²C | `adafruit_ht16k33` | yes | P1 |
| MAX7219 (8×8 matrix / 7-seg) | SPI | `adafruit_max7219` | yes | P1 |
| HD44780 char LCD (16×2, PCF8574) | I²C | `adafruit_charlcd` | yes | P0 |
| Nokia 5110 (PCD8544) | SPI | `adafruit_pcd8544` | yes | P2 |

### Output · Addressable LED / Audio
| Part | Bus | CP | MP | Pri |
|------|-----|----|----|----|
| WS2812B / NeoPixel | 1-wire | `neopixel` | built-in (`neopixel`) | P0 |
| APA102 / DotStar | SPI | `adafruit_dotstar` | yes | P1 |
| MAX98357A / PAM8302 I²S/analog amp | I²S/analog | — | native I²S | P1 |
| DFPlayer Mini (MP3) | UART | — | yes | P1 |
| Passive/active buzzer | PWM/digital | — | trivial | P0 |

### Motor · Drivers
| Part | Bus | CP | MP | Pri |
|------|-----|----|----|----|
| L298N (dual H-bridge) | digital/PWM | — | trivial | P0 |
| TB6612FNG | digital/PWM | — | trivial | P0 |
| DRV8833 | digital/PWM | — | trivial | P1 |
| MX1508 | digital/PWM | — | trivial (shipped) | — |
| A4988 / DRV8825 (stepper) | step/dir | — | trivial | P1 |
| PCA9685 (16-ch servo/PWM) | I²C | `adafruit_pca9685` | yes | P0 |
| SG90 / MG996R servo | PWM | `adafruit_motor` | native PWM | P0 |
| N20 gearmotor | — | — | (shipped) | — |

### IC · IO expander / ADC / DAC / Memory / RTC
| Part | Bus | CP | MP | Pri |
|------|-----|----|----|----|
| PCF8574 (8-bit GPIO expander) | I²C | `adafruit_pcf8574` | yes | P0 |
| MCP23017 (16-bit GPIO expander) | I²C | `adafruit_mcp230xx` | yes | P1 |
| ADS1115 (4-ch 16-bit ADC) | I²C | `adafruit_ads1x15` | yes | P0 |
| MCP4725 (12-bit DAC) | I²C | `adafruit_mcp4725` | yes | P1 |
| TCA9548A (I²C mux) | I²C | `adafruit_tca9548a` | yes | P1 |
| MPR121 (12-ch cap touch) | I²C | `adafruit_mpr121` | yes | P1 |
| HX711 (load-cell ADC) | 2-wire | `adafruit_hx711` | yes | P1 |
| DS3231 (precision RTC) | I²C | `adafruit_ds3231` | yes | P0 |
| DS1307 (RTC) | I²C | `adafruit_ds1307` | yes | P1 |
| AT24C32 EEPROM / FM24 FRAM | I²C | `adafruit_24lc32/_fram` | yes | P2 |
| 74HC595 (shift register) | SPI-ish | `adafruit_74hc595` | trivial | P1 |

### Power · Current / Fuel gauge
| Part | Bus | CP | MP | Pri |
|------|-----|----|----|----|
| INA219 (current/power) | I²C | `adafruit_ina219` | yes | P0 |
| INA260 (current/power) | I²C | `adafruit_ina260` | yes | P1 |
| MAX17048 (LiPo fuel gauge) | I²C | `adafruit_max1704x` | yes | P1 |
| ACS712 (hall current) | analog | — | trivial | P2 |

### Communication · Wireless / Wired
| Part | Bus | CP | MP | Pri |
|------|-----|----|----|----|
| nRF24L01+ (2.4 GHz) | SPI | — | yes | P1 |
| RFM95W (LoRa) | SPI | `adafruit_rfm9x` | yes | P1 |
| PN532 (NFC/RFID) | I²C/SPI/UART | `adafruit_pn532` | yes | P1 |
| NEO-6M / NEO-M8N (GPS) | UART | `adafruit_gps` | yes | P1 |
| W5500 (Ethernet) | SPI | `adafruit_wiznet5k` | yes | P2 |
| MCP2515 (CAN) | SPI | `adafruit_mcp2515` | yes | P2 |

### Input · Human interface
| Part | Bus | CP | MP | Pri |
|------|-----|----|----|----|
| Rotary encoder (EC11) | 2×digital+btn | `adafruit_seesaw`* | trivial | P0 |
| 4×4 matrix keypad | digital | `adafruit_matrixkeypad` | trivial | P1 |
| 2-axis joystick + button | 2×analog+digital | — | trivial | P0 |
| Tactile button / potentiometer | digital / analog | — | trivial | P0 |

## Worked example — HX8357 (the one you asked for)

`adafruit_hx8357` is a **480×320 SPI TFT** (e.g. the Adafruit 3.5" TFT). Deliverables:

1. **Part** — `my-parts/hx8357/parts.yml` (or `snakie-standard/hx8357/`):
   `family: Display`, `tags: [display, tft, spi, hx8357]`, image of the breakout,
   header pins **VIN, GND, SCK, MOSI(SI/DI), MISO(SO/DO), CS, D/C, RST, LITE(backlight)**
   (+ the touch pins if the module has a resistive/cap touch controller — often
   STMPE610 or TSC2007, which becomes its own linked part). Each SPI pin gets
   `capabilities: [spi]` + `signals` (SCK / TX(MOSI) / RX(MISO) / CSn).
2. **Mini-help** — `hx8357/help.md`: “3.5″ 480×320 SPI TFT. Wire VIN→3V3, GND→GND,
   SCK→SPI SCK, MOSI→SPI TX, MISO→SPI RX, CS→any GPIO, DC→any GPIO, RST→any GPIO.”
   + a minimal MicroPython snippet driving it, + links.
3. **Driver** — set `library`/`drivers` to a MicroPython HX8357 driver. There is a
   solid CircuitPython driver but MicroPython support is thinner, so **flag
   “port needed”**: link `adafruit_hx8357`, and the closest MP option (an
   ILI9341/ST77xx-style SPI TFT driver adapted for HX8357’s init sequence).

```yaml
# hx8357/parts.yml (excerpt)
family: Display
tags: [display, tft, spi, hx8357]
library:
  module: hx8357
  url: "github:… (MicroPython HX8357 — port from adafruit_hx8357 if none)"
  docs: "https://docs.circuitpython.org/projects/hx8357/en/latest/"
drivers:
  - { source: "github:…/hx8357.py", target: "lib/hx8357.py", label: "HX8357 TFT driver" }
```

## Rollout order

1. **P0 sweep** (the ~25 ubiquitous parts above) — biggest coverage per unit effort.
2. Then **P1** by category, displays and sensors first (highest demand).
3. Backfill sub-category `tags` + normalise families as parts land, so the Board
   View sections stay tidy.
