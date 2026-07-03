# MicroPython-compatible boards

A catalogue of boards with an official MicroPython build, i.e. every board that
ships a `board.json` in the mainline [micropython/micropython](https://github.com/micropython/micropython)
tree. For each board: **supplier** (vendor), **board name** (product), **model**
(the MicroPython build-target / board id you flash), and **chip type** (MCU).

- **Total boards:** 219 across 10 MCU ports.
- **Source:** mainline `ports/*/boards/*/board.json` (authoritative, machine-generated).
- **Snapshot:** July 2026 (mainline `master`).

> Notes
> - The `ESP32_GENERIC*` and `ESP8266_GENERIC` targets cover the countless
>   third-party ESP dev boards (NodeMCU, DOIT, HiLetgo, etc.) that share a chip.
> - Some vendors (e.g. Pimoroni, Arduino, LEGO) also ship **extra** boards in their
>   own MicroPython forks that are not in mainline and so are not listed here.
> - Vendor strings are reproduced verbatim from upstream, so minor naming variants
>   exist (e.g. "WeAct" vs "WeAct Studio").

## Summary by port

| Port | MCU family | Boards |
|------|-----------|-------:|
| `rp2` | Raspberry Pi RP2 — RP2040 / RP2350 | 38 |
| `esp32` | Espressif ESP32 family | 42 |
| `esp8266` | Espressif ESP8266 | 1 |
| `stm32` | STMicroelectronics STM32 | 74 |
| `samd` | Microchip SAMD (SAM D21 / D51) | 18 |
| `nrf` | Nordic Semiconductor nRF | 23 |
| `mimxrt` | NXP i.MX RT | 14 |
| `renesas-ra` | Renesas RA | 7 |
| `alif` | Alif Ensemble | 1 |
| `cc3200` | Texas Instruments CC3200 | 1 |
| | **Total** | **219** |

## Raspberry Pi RP2 — RP2040 / RP2350

Port: `rp2` — 38 boards.

| Supplier | Board name | Model (build target) | Chip |
|----------|-----------|----------------------|------|
| Adafruit | Feather RP2040 | `ADAFRUIT_FEATHER_RP2040` | RP2040 |
| Adafruit | Feather RP2350 | `ADAFRUIT_FEATHER_RP2350` | RP2350 |
| Adafruit | ItsyBitsy RP2040 | `ADAFRUIT_ITSYBITSY_RP2040` | RP2040 |
| Adafruit | QT Py RP2040 | `ADAFRUIT_QTPY_RP2040` | RP2040 |
| Arduino | Nano RP2040 Connect | `ARDUINO_NANO_RP2040_CONNECT` | RP2040 |
| Cytron | MOTION 2350 Pro | `CYTRON_MOTION_2350_PRO` | RP2350 |
| Cytron | NanoXRP Controller | `CYTRON_NANOXRP_CONTROLLER` | RP2040 |
| Machdyne | Werkzeug | `MACHDYNE_WERKZEUG` | RP2040 |
| McHobby | RP2040 PYBStick | `GARATRONIC_PYBSTICK26_RP2040` | RP2040 |
| nullbits | Bit-C PRO | `NULLBITS_BIT_C_PRO` | RP2040 |
| Pimoroni | Pico LiPo | `PIMORONI_PICOLIPO` | RP2040 |
| Pimoroni | Tiny2040 | `PIMORONI_TINY2040` | RP2040 |
| Pololu | 3pi+ 2040 Robot | `POLOLU_3PI_2040_ROBOT` | RP2040 |
| Pololu | Zumo 2040 Robot | `POLOLU_ZUMO_2040_ROBOT` | RP2040 |
| Raspberry Pi | Pico | `RPI_PICO` | RP2040 |
| Raspberry Pi | Pico 2 | `RPI_PICO2` | RP2350 |
| Raspberry Pi | Pico 2 W | `RPI_PICO2_W` | RP2350 |
| Raspberry Pi | Pico W | `RPI_PICO_W` | RP2040 |
| Seeed Studio | XIAO RP2040 | `SEEED_XIAO_RP2040` | RP2040 |
| Seeed Studio | XIAO RP2350 | `SEEED_XIAO_RP2350` | RP2350 |
| Silicognition LLC | RP2040-Shim | `SIL_RP2040_SHIM` | RP2040 |
| Soldered Electronics | NULA RP2350 | `SOLDERED_NULA_MAX_RP2350` | RP2350 |
| SparkFun | IoT Node LoRaWAN RP2350 | `SPARKFUN_IOTNODE_LORAWAN_RP2350` | RP2350 |
| SparkFun | Pro Micro - RP2040 | `SPARKFUN_PROMICRO` | RP2040 |
| SparkFun | Pro Micro RP2350 | `SPARKFUN_PROMICRO_RP2350` | RP2350 |
| SparkFun | SparkFun IoT RedBoard RP2350 | `SPARKFUN_IOTREDBOARD_RP2350` | RP2350 |
| SparkFun | Thing Plus - RP2040 | `SPARKFUN_THINGPLUS` | RP2040 |
| SparkFun | Thing Plus RP2350 | `SPARKFUN_THINGPLUS_RP2350` | RP2350 |
| SparkFun | XRP Controller | `SPARKFUN_XRP_CONTROLLER` | RP2350 |
| SparkFun | XRP Controller (Beta) | `SPARKFUN_XRP_CONTROLLER_BETA` | RP2040 |
| Waveshare | RP2040-LCD-0.96 | `WAVESHARE_RP2040_LCD_0_96` | RP2040 |
| Waveshare | RP2040-Plus | `WAVESHARE_RP2040_PLUS` | RP2040 |
| Waveshare | RP2040-Zero | `WAVESHARE_RP2040_ZERO` | RP2040 |
| Waveshare | RP2350B Core | `WAVESHARE_RP2350B_CORE` | RP2350 |
| WeAct | Studio RP2040 | `WEACTSTUDIO` | RP2040 |
| WeAct Studio | RP2350B Core | `WEACTSTUDIO_RP2350B_CORE` | RP2350 |
| WIZnet | W5100S-EVB-Pico | `W5100S_EVB_PICO` | RP2040 |
| WIZnet | W5500-EVB-Pico | `W5500_EVB_PICO` | RP2040 |

## Espressif ESP32 family

Port: `esp32` — 42 boards.

| Supplier | Board name | Model (build target) | Chip |
|----------|-----------|----------------------|------|
| Arduino | Nano ESP32 | `ARDUINO_NANO_ESP32` | ESP32-S3 |
| Espressif | ESP32 / WROOM | `ESP32_GENERIC` | ESP32 |
| Espressif | ESP32-C2 | `ESP32_GENERIC_C2` | ESP32-C2 |
| Espressif | ESP32-C3 | `ESP32_GENERIC_C3` | ESP32-C3 |
| Espressif | ESP32-C5 | `ESP32_GENERIC_C5` | ESP32-C5 |
| Espressif | ESP32-C6 | `ESP32_GENERIC_C6` | ESP32-C6 |
| Espressif | ESP32-P4 | `ESP32_GENERIC_P4` | ESP32-P4 |
| Espressif | ESP32-S2 | `ESP32_GENERIC_S2` | ESP32-S2 |
| Espressif | ESP32-S3 | `ESP32_GENERIC_S3` | ESP32-S3 |
| LILYGO | T3-S3 | `LILYGO_T3_S3` | ESP32-S3 |
| LILYGO | TTGO LoRa32 | `LILYGO_TTGO_LORA32` | ESP32 |
| M5Stack | Atom | `M5STACK_ATOM` | ESP32 |
| M5Stack | AtomS3 Lite | `M5STACK_ATOMS3_LITE` | ESP32-S3 |
| M5Stack | NanoC6 | `M5STACK_NANOC6` | ESP32-C6 |
| McHobby | PYBSTICK26_ESP32C3 | `GARATRONIC_PYBSTICK26_ESP32C3` | ESP32-C3 |
| Olimex | ESP32 EVB | `OLIMEX_ESP32_EVB` | ESP32 |
| Olimex | ESP32 POE | `OLIMEX_ESP32_POE` | ESP32 |
| Seeed Studio | XIAO ESP32C3 | `SEEED_XIAO_ESP32C3` | ESP32-C3 |
| Seeed Studio | XIAO ESP32C5 | `SEEED_XIAO_ESP32C5` | ESP32-C5 |
| Seeed Studio | XIAO ESP32C6 | `SEEED_XIAO_ESP32C6` | ESP32-C6 |
| Seeed Studio | XIAO ESP32S3 | `SEEED_XIAO_ESP32S3` | ESP32-S3 |
| Silicognition | wESP32 | `SIL_WESP32` | ESP32 |
| Silicognition LLC | ManT1S | `SIL_MANT1S` | ESP32 |
| Soldered Electronics | NULA Mini | `SOLDERED_NULA_MINI` | ESP32-C6 |
| SparkFun | ESP32 / WROOM | `SPARKFUN_IOT_REDBOARD_ESP32` | ESP32 |
| SparkFun | Thing Plus ESP32-C5 | `SPARKFUN_THINGPLUS_ESP32C5` | ESP32-C5 |
| Unexpected Maker | FeatherS2 | `UM_FEATHERS2` | ESP32-S2 |
| Unexpected Maker | FeatherS2 Neo | `UM_FEATHERS2NEO` | ESP32-S2 |
| Unexpected Maker | FeatherS3 | `UM_FEATHERS3` | ESP32-S3 |
| Unexpected Maker | FeatherS3 Neo | `UM_FEATHERS3NEO` | ESP32-S3 |
| Unexpected Maker | NanoS3 | `UM_NANOS3` | ESP32-S3 |
| Unexpected Maker | OMGS3 | `UM_OMGS3` | ESP32-S3 |
| Unexpected Maker | ProS3 | `UM_PROS3` | ESP32-S3 |
| Unexpected Maker | RGB Touch Mini | `UM_RGBTOUCH_MINI` | ESP32-S3 |
| Unexpected Maker | TinyC6 | `UM_TINYC6` | ESP32-C6 |
| Unexpected Maker | TinyPICO | `UM_TINYPICO` | ESP32 |
| Unexpected Maker | TinyS2 | `UM_TINYS2` | ESP32-S2 |
| Unexpected Maker | TinyS3 | `UM_TINYS3` | ESP32-S3 |
| Unexpected Maker | TinyWATCH S3 | `UM_TINYWATCHS3` | ESP32-S3 |
| Wemos | C3 mini | `LOLIN_C3_MINI` | ESP32-C3 |
| Wemos | S2 mini | `LOLIN_S2_MINI` | ESP32-S2 |
| Wemos | S2 pico | `LOLIN_S2_PICO` | ESP32-S2 |

## Espressif ESP8266

Port: `esp8266` — 1 board.

| Supplier | Board name | Model (build target) | Chip |
|----------|-----------|----------------------|------|
| Espressif | ESP8266 | `ESP8266_GENERIC` | ESP8266 |

## STMicroelectronics STM32

Port: `stm32` — 74 boards.

| Supplier | Board name | Model (build target) | Chip |
|----------|-----------|----------------------|------|
| Adafruit | F405 Express | `ADAFRUIT_F405_EXPRESS` | STM32F4 |
| Arduino | Giga | `ARDUINO_GIGA` | STM32H7 |
| Arduino | Nicla Vision | `ARDUINO_NICLA_VISION` | STM32H7 |
| Arduino | Opta WiFi | `ARDUINO_OPTA` | STM32H7 |
| Arduino | Portenta H7 | `ARDUINO_PORTENTA_H7` | STM32H7 |
| Espruino | Pico | `ESPRUINO_PICO` | STM32F4 |
| Fez | Cerb40 | `CERB40` | STM32F4 |
| George Robotics | Pyboard D-series SF2 | `PYBD_SF2` | STM32F7 |
| George Robotics | Pyboard D-series SF3 | `PYBD_SF3` | STM32F7 |
| George Robotics | Pyboard D-series SF6 | `PYBD_SF6` | STM32F7 |
| George Robotics | Pyboard Lite v1.0 | `PYBLITEV10` | STM32F4 |
| George Robotics | Pyboard v1.0 | `PYBV10` | STM32F4 |
| George Robotics | Pyboard v1.1 | `PYBV11` | STM32F4 |
| HydraBus | HydraBus v1.0 | `HYDRABUS` | STM32F4 |
| LEGO | Hub No.6 | `LEGO_HUB_NO6` | STM32F4 |
| LEGO | Hub No.7 | `LEGO_HUB_NO7` | STM32F4 |
| LimiFrog | LimiFrog | `LIMIFROG` | STM32L4 |
| McHobby | GARATRONIC_NADHAT_F405 | `GARATRONIC_NADHAT_F405` | STM32F4 |
| McHobby | GARATRONIC_PYBSTICK26_F411 | `GARATRONIC_PYBSTICK26_F411` | STM32F4 |
| MikroElektronika | MikroE Clicker 2 for STM32 | `MIKROE_CLICKER2_STM32` | STM32F4 |
| MikroElektronika | MikroE Quail | `MIKROE_QUAIL` | STM32F4 |
| Netduino | Netduino Plus 2 | `NETDUINO_PLUS_2` | STM32F4 |
| Olimex | STM32-E407 | `OLIMEX_E407` | STM32F4 |
| Olimex | STM32-H407 | `OLIMEX_H407` | STM32F4 |
| SparkFun | MicroMod STM32 | `SPARKFUN_MICROMOD_STM32` | STM32F4 |
| ST Microelectronics | B_L072Z_LRWAN1 | `B_L072Z_LRWAN1` | STM32L0 |
| ST Microelectronics | B_L475E_IOT01A | `B_L475E_IOT01A` | STM32L4 |
| ST Microelectronics | Discovery F4 | `STM32F4DISC` | STM32F4 |
| ST Microelectronics | Discovery F411 | `STM32F411DISC` | STM32F4 |
| ST Microelectronics | Discovery F429 | `STM32F429DISC` | STM32F4 |
| ST Microelectronics | Discovery F469 | `STM32F469DISC` | STM32F4 |
| ST Microelectronics | Discovery F7 | `STM32F7DISC` | STM32F7 |
| ST Microelectronics | Discovery F769 | `STM32F769DISC` | STM32F7 |
| ST Microelectronics | Discovery Kit H7 | `STM32H7B3I_DK` | STM32H7 |
| ST Microelectronics | Discovery Kit H747I | `STM32H747I_DISCO` | STM32H7 |
| ST Microelectronics | Discovery L476 | `STM32L476DISC` | STM32L4 |
| ST Microelectronics | Discovery L496G | `STM32L496GDISC` | STM32L4 |
| ST Microelectronics | Nucleo F091RC | `NUCLEO_F091RC` | STM32F0 |
| ST Microelectronics | Nucleo F401RE | `NUCLEO_F401RE` | STM32F4 |
| ST Microelectronics | Nucleo F411RE | `NUCLEO_F411RE` | STM32F4 |
| ST Microelectronics | Nucleo F412ZG | `NUCLEO_F412ZG` | STM32F4 |
| ST Microelectronics | Nucleo F413ZH | `NUCLEO_F413ZH` | STM32F4 |
| ST Microelectronics | Nucleo F429ZI | `NUCLEO_F429ZI` | STM32F4 |
| ST Microelectronics | Nucleo F439ZI | `NUCLEO_F439ZI` | STM32F4 |
| ST Microelectronics | Nucleo F446RE | `NUCLEO_F446RE` | STM32F4 |
| ST Microelectronics | Nucleo F722ZE | `NUCLEO_F722ZE` | STM32F7 |
| ST Microelectronics | Nucleo F746ZG | `NUCLEO_F746ZG` | STM32F7 |
| ST Microelectronics | Nucleo F756ZG | `NUCLEO_F756ZG` | STM32F7 |
| ST Microelectronics | Nucleo F767ZI | `NUCLEO_F767ZI` | STM32F7 |
| ST Microelectronics | Nucleo G0B1RE | `NUCLEO_G0B1RE` | STM32G0 |
| ST Microelectronics | Nucleo G474RE | `NUCLEO_G474RE` | STM32G4 |
| ST Microelectronics | Nucleo H563ZI | `NUCLEO_H563ZI` | STM32H5 |
| ST Microelectronics | Nucleo H723ZG | `NUCLEO_H723ZG` | STM32H7 |
| ST Microelectronics | Nucleo H743ZI | `NUCLEO_H743ZI` | STM32H7 |
| ST Microelectronics | Nucleo H743ZI2 | `NUCLEO_H743ZI2` | STM32H7 |
| ST Microelectronics | Nucleo H753ZI | `NUCLEO_H753ZI` | STM32H7 |
| ST Microelectronics | Nucleo H7A3ZI-Q | `NUCLEO_H7A3ZI_Q` | STM32H7 |
| ST Microelectronics | Nucleo L073RZ | `NUCLEO_L073RZ` | STM32L0 |
| ST Microelectronics | Nucleo L152RE | `NUCLEO_L152RE` | STM32L1 |
| ST Microelectronics | Nucleo L432KC | `NUCLEO_L432KC` | STM32L4 |
| ST Microelectronics | Nucleo L452RE | `NUCLEO_L452RE` | STM32L4 |
| ST Microelectronics | Nucleo L476RG | `NUCLEO_L476RG` | STM32L4 |
| ST Microelectronics | Nucleo L4A6ZG | `NUCLEO_L4A6ZG` | STM32L4 |
| ST Microelectronics | Nucleo U5A5ZJ_Q | `NUCLEO_U5A5ZJ_Q` | STM32U5 |
| ST Microelectronics | Nucleo WB55 | `NUCLEO_WB55` | STM32WB |
| ST Microelectronics | Nucleo WL55 | `NUCLEO_WL55` | STM32WL |
| ST Microelectronics | STM32F439 | `STM32F439` | STM32F4 |
| ST Microelectronics | USBDONGLE_WB55 | `USBDONGLE_WB55` | STM32WB |
| VCC-GND Studio | F407VE | `VCC_GND_F407VE` | STM32F4 |
| VCC-GND Studio | F407ZG | `VCC_GND_F407ZG` | STM32F4 |
| VCC-GND Studio | H743VI | `VCC_GND_H743VI` | STM32H7 |
| WeAct Studio | Mini STM32H743 | `WEACTSTUDIO_MINI_STM32H743` | STM32H7 |
| WeAct Studio | Mini STM32U585 | `WEACTSTUDIO_MINI_STM32U585` | STM32U5 |
| WeAct Studio | WeAct F411 'blackpill'. Default variant is v3.1 with no SPI Flash. | `WEACT_F411_BLACKPILL` | STM32F411 |

## Microchip SAMD (SAM D21 / D51)

Port: `samd` — 18 boards.

| Supplier | Board name | Model (build target) | Chip |
|----------|-----------|----------------------|------|
| Adafruit | Feather M0 Express | `ADAFRUIT_FEATHER_M0_EXPRESS` | SAMD21 |
| Adafruit | Feather M4 Express | `ADAFRUIT_FEATHER_M4_EXPRESS` | SAMD51 |
| Adafruit | ItsyBitsy M0 Express | `ADAFRUIT_ITSYBITSY_M0_EXPRESS` | SAMD21 |
| Adafruit | ItsyBitsy M4 Express | `ADAFRUIT_ITSYBITSY_M4_EXPRESS` | SAMD51 |
| Adafruit | Metro M4 Express Airlift | `ADAFRUIT_METRO_M4_EXPRESS` | SAMD51 |
| Adafruit | NeoKey Trinkey | `ADAFRUIT_NEOKEY_TRINKEY` | SAMD21 |
| Adafruit | QT Py - SAMD21 | `ADAFRUIT_QTPY_SAMD21` | SAMD21 |
| Adafruit | Trinket M0 | `ADAFRUIT_TRINKET_M0` | SAMD21 |
| Microchip | Generic SAMD21J18 | `SAMD_GENERIC_D21X18` | SAMD21 |
| Microchip | Generic SAMD51P19 | `SAMD_GENERIC_D51X19` | SAMD51 |
| Microchip | Generic SAMD51P20 | `SAMD_GENERIC_D51X20` | SAMD51 |
| Microchip | SAMD21 Xplained Pro | `SAMD21_XPLAINED_PRO` | SAMD21 |
| MiniFig Boards | Mini SAM M4 | `MINISAM_M4` | SAMD51 |
| Seeed Studio | Wio Terminal D51R | `SEEED_WIO_TERMINAL` | SAMD51 |
| Seeed Studio | XIAO SAMD21 | `SEEED_XIAO_SAMD21` | SAMD21 |
| SparkFun | SAMD51 Thing Plus | `SPARKFUN_SAMD51_THING_PLUS` | SAMD51 |
| SparkFun | SparkFun RedBoard Turbo | `SPARKFUN_REDBOARD_TURBO` | SAMD21 |
| SparkFun | SparkFun SAMD21 Dev Breakout | `SPARKFUN_SAMD21_DEV_BREAKOUT` | SAMD21 |

## Nordic Semiconductor nRF

Port: `nrf` — 23 boards.

| Supplier | Board name | Model (build target) | Chip |
|----------|-----------|----------------------|------|
| Actinius | Icarus | `ACTINIUS_ICARUS` | nRF91 |
| Adafruit | Feather nRF52840 Express | `FEATHER52` | nRF52 |
| Arduino | Nano 33 BLE Sense | `ARDUINO_NANO_33_BLE_SENSE` | nRF52 |
| Arduino | Primo | `ARDUINO_PRIMO` | nRF52 |
| BBC | micro:bit v1 | `MICROBIT` | nRF51 |
| Ezurio | DVK-BL652 | `DVK_BL652` | nRF52 |
| I-SYST | BLUEIO Tag EVIM | `BLUEIO_TAG_EVIM` | nRF52 |
| I-SYST | IBK BLYST Nano | `IBK_BLYST_NANO` | nRF52 |
| I-SYST | IDK BLYST Nano | `IDK_BLYST_NANO` | nRF52 |
| Makerdiary | nrf52840 MDK USB Dongle | `NRF52840_MDK_USB_DONGLE` | nRF52 |
| Nordic Semiconductor | pca10000 | `PCA10000` | nRF51 |
| Nordic Semiconductor | pca10001 | `PCA10001` | nRF51 |
| Nordic Semiconductor | pca10028 | `PCA10028` | nRF51 |
| Nordic Semiconductor | pca10031 | `PCA10031` | nRF51 |
| Nordic Semiconductor | pca10040 | `PCA10040` | nRF52 |
| Nordic Semiconductor | pca10056 | `PCA10056` | nRF52 |
| Nordic Semiconductor | pca10059 | `PCA10059` | nRF52 |
| Nordic Semiconductor | pca10090 | `PCA10090` | nRF91 |
| Particle | Xenon | `PARTICLE_XENON` | nRF52 |
| Seeed Studio | XIAO nRF52840 Sense | `SEEED_XIAO_NRF52` | nRF52 |
| u-blox | EVK-NINA-B1 | `EVK_NINA_B1` | nRF52 |
| u-blox | EVK-NINA-B3 | `EVK_NINA_B3` | nRF52 |
| Wireless-Tag | WT51822-S4AT | `WT51822_S4AT` | nRF51 |

## NXP i.MX RT

Port: `mimxrt` — 14 boards.

| Supplier | Board name | Model (build target) | Chip |
|----------|-----------|----------------------|------|
| Adafruit | Metro M7 | `ADAFRUIT_METRO_M7` | i.MX RT |
| Makerdiary | iMX RT1011 Nano Kit | `MAKERDIARY_RT1011_NANO_KIT` | i.MX RT |
| NXP | MIMXRT1010_EVK | `MIMXRT1010_EVK` | i.MX RT |
| NXP | MIMXRT1015_EVK | `MIMXRT1015_EVK` | i.MX RT |
| NXP | MIMXRT1020_EVK | `MIMXRT1020_EVK` | i.MX RT |
| NXP | MIMXRT1050_EVK | `MIMXRT1050_EVK` | i.MX RT |
| NXP | MIMXRT1060_EVK | `MIMXRT1060_EVK` | i.MX RT |
| NXP | MIMXRT1064_EVK | `MIMXRT1064_EVK` | i.MX RT |
| NXP | MIMXRT1170_EVK | `MIMXRT1170_EVK` | i.MX RT |
| Olimex | RT1010-Py | `OLIMEX_RT1010` | i.MX RT |
| PHYTEC | phyBOARD-RT1170 Development Kit | `PHYBOARD_RT1170` | i.MX RT |
| PJRC | Teensy 4.0 | `TEENSY40` | i.MX RT |
| PJRC | Teensy 4.1 | `TEENSY41` | i.MX RT |
| Seeed Studio | Arch Mix | `SEEED_ARCH_MIX` | i.MX RT |

## Renesas RA

Port: `renesas-ra` — 7 boards.

| Supplier | Board name | Model (build target) | Chip |
|----------|-----------|----------------------|------|
| Arduino | Portenta C33 | `ARDUINO_PORTENTA_C33` | RA6M5 |
| MikroElektronika | Mikroe RA4M1 Clicker | `RA4M1_CLICKER` | RA4M1 |
| Renesas Electronics | EK-RA4M1 | `EK_RA4M1` | RA4M1 |
| Renesas Electronics | EK-RA4W1 | `EK_RA4W1` | RA4W1 |
| Renesas Electronics | EK-RA6M1 | `EK_RA6M1` | RA6M1 |
| Renesas Electronics | EK-RA6M2 | `EK_RA6M2` | RA6M2 |
| Vekatech | VK-RA6M5 | `VK_RA6M5` | RA6M5 |

## Alif Ensemble

Port: `alif` — 1 board.

| Supplier | Board name | Model (build target) | Chip |
|----------|-----------|----------------------|------|
| Alif Semiconductor | Ensemble E7 DevKit | `ALIF_ENSEMBLE` | Alif Ensemble E7 (AE722F80F55D5XX) |

## Texas Instruments CC3200

Port: `cc3200` — 1 board.

| Supplier | Board name | Model (build target) | Chip |
|----------|-----------|----------------------|------|
| Pycom | WiPy Module | `WIPY` | CC3200 |

