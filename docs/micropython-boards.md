# MicroPython-compatible boards

A catalogue of boards with an official MicroPython build, i.e. every board that
ships a `board.json` in the mainline [micropython/micropython](https://github.com/micropython/micropython)
tree. For each board: **supplier** (vendor), **board name** (product), **model**
(the MicroPython build-target / board id you flash), and **chip type** (MCU).

- **Total boards:** 225 across 11 MCU ports.
- **MicroPython:** `v1.29.0`.
- **Source:** `src/renderer/public/boards/boards.json`, generated from mainline `ports/*/boards/*/board.json`.
- **Generated:** 2026-09-05 — **do not edit by hand**, run `node scripts/build-boards-doc.mjs`.

> Notes
> - Snakie’s **Board Finder** shows these plus 12 more that MicroPython
>   builds nothing for but people own anyway — the Adafruit ESP32 Feather V2, the
>   micro:bit v2, Pimoroni’s Tiny 2350 and Servo 2040 and others. They are not in
>   this table because the one column it exists to give — the build target you
>   flash — is precisely what they do not have. See `src/shared/board-overlay.ts`.
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
| `esp32` | Espressif ESP32 family | 45 |
| `esp8266` | Espressif ESP8266 | 1 |
| `stm32` | STMicroelectronics STM32 | 76 |
| `samd` | Microchip SAMD (SAM D21 / D51) | 18 |
| `nrf` | Nordic Semiconductor nRF | 23 |
| `mimxrt` | NXP i.MX RT | 14 |
| `renesas-ra` | Renesas RA | 7 |
| `alif` | Alif Ensemble | 1 |
| `psoc-edge` | Infineon PSoC Edge | 1 |
| `cc3200` | Texas Instruments CC3200 | 1 |
| | **Total** | **225** |

## Raspberry Pi RP2 — RP2040 / RP2350

Port: `rp2` — 38 boards.

| Supplier | Board name | Model (build target) | Chip |
|----------|-----------|----------------------|------|
| Adafruit | Feather RP2040 | `ADAFRUIT_FEATHER_RP2040` | rp2040 |
| Adafruit | Feather RP2350 | `ADAFRUIT_FEATHER_RP2350` | rp2350 |
| Adafruit | ItsyBitsy RP2040 | `ADAFRUIT_ITSYBITSY_RP2040` | rp2040 |
| Adafruit | QT Py RP2040 | `ADAFRUIT_QTPY_RP2040` | rp2040 |
| Arduino | Nano RP2040 Connect | `ARDUINO_NANO_RP2040_CONNECT` | rp2040 |
| Cytron | MOTION 2350 Pro | `CYTRON_MOTION_2350_PRO` | rp2350 |
| Cytron | NanoXRP Controller | `CYTRON_NANOXRP_CONTROLLER` | rp2040 |
| Machdyne | Werkzeug | `MACHDYNE_WERKZEUG` | rp2040 |
| McHobby | RP2040 PYBStick | `GARATRONIC_PYBSTICK26_RP2040` | rp2040 |
| nullbits | Bit-C PRO | `NULLBITS_BIT_C_PRO` | rp2040 |
| Pimoroni | Pico LiPo | `PIMORONI_PICOLIPO` | rp2040 |
| Pimoroni | Tiny2040 | `PIMORONI_TINY2040` | rp2040 |
| Pololu | 3pi+ 2040 Robot | `POLOLU_3PI_2040_ROBOT` | rp2040 |
| Pololu | Zumo 2040 Robot | `POLOLU_ZUMO_2040_ROBOT` | rp2040 |
| Raspberry Pi | Pico | `RPI_PICO` | rp2040 |
| Raspberry Pi | Pico 2 | `RPI_PICO2` | rp2350 |
| Raspberry Pi | Pico 2 W | `RPI_PICO2_W` | rp2350 |
| Raspberry Pi | Pico W | `RPI_PICO_W` | rp2040 |
| Seeed Studio | XIAO RP2040 | `SEEED_XIAO_RP2040` | rp2040 |
| Seeed Studio | XIAO RP2350 | `SEEED_XIAO_RP2350` | rp2350 |
| Silicognition LLC | RP2040-Shim | `SIL_RP2040_SHIM` | rp2040 |
| Soldered Electronics | NULA RP2350 | `SOLDERED_NULA_MAX_RP2350` | rp2350 |
| SparkFun | IoT Node LoRaWAN RP2350 | `SPARKFUN_IOTNODE_LORAWAN_RP2350` | rp2350 |
| SparkFun | Pro Micro - RP2040 | `SPARKFUN_PROMICRO` | rp2040 |
| SparkFun | Pro Micro RP2350 | `SPARKFUN_PROMICRO_RP2350` | rp2350 |
| SparkFun | SparkFun IoT RedBoard RP2350 | `SPARKFUN_IOTREDBOARD_RP2350` | rp2350 |
| SparkFun | Thing Plus - RP2040 | `SPARKFUN_THINGPLUS` | rp2040 |
| SparkFun | Thing Plus RP2350 | `SPARKFUN_THINGPLUS_RP2350` | rp2350 |
| SparkFun | XRP Controller | `SPARKFUN_XRP_CONTROLLER` | rp2350 |
| SparkFun | XRP Controller (Beta) | `SPARKFUN_XRP_CONTROLLER_BETA` | rp2040 |
| Waveshare | RP2040-LCD-0.96 | `WAVESHARE_RP2040_LCD_0_96` | rp2040 |
| Waveshare | RP2040-Plus | `WAVESHARE_RP2040_PLUS` | rp2040 |
| Waveshare | RP2040-Zero | `WAVESHARE_RP2040_ZERO` | rp2040 |
| Waveshare | RP2350B Core | `WAVESHARE_RP2350B_CORE` | rp2350 |
| WeAct Studio | RP2350B Core | `WEACTSTUDIO_RP2350B_CORE` | rp2350 |
| WeAct | Studio RP2040 | `WEACTSTUDIO` | rp2040 |
| WIZnet | W5100S-EVB-Pico | `W5100S_EVB_PICO` | rp2040 |
| WIZnet | W5500-EVB-Pico | `W5500_EVB_PICO` | rp2040 |

## Espressif ESP32 family

Port: `esp32` — 45 boards.

| Supplier | Board name | Model (build target) | Chip |
|----------|-----------|----------------------|------|
| Arduino | Nano ESP32 | `ARDUINO_NANO_ESP32` | esp32s3 |
| Espressif | ESP32 / WROOM | `ESP32_GENERIC` | esp32 |
| Espressif | ESP32-C2 | `ESP32_GENERIC_C2` | esp32c2 |
| Espressif | ESP32-C3 | `ESP32_GENERIC_C3` | esp32c3 |
| Espressif | ESP32-C5 | `ESP32_GENERIC_C5` | esp32c5 |
| Espressif | ESP32-C6 | `ESP32_GENERIC_C6` | esp32c6 |
| Espressif | ESP32-H2 | `ESP32_GENERIC_H2` | esp32h2 |
| Espressif | ESP32-P4 | `ESP32_GENERIC_P4` | esp32p4 |
| Espressif | ESP32-S2 | `ESP32_GENERIC_S2` | esp32s2 |
| Espressif | ESP32-S3 | `ESP32_GENERIC_S3` | esp32s3 |
| LILYGO | T3-S3 | `LILYGO_T3_S3` | esp32s3 |
| LILYGO | TTGO LoRa32 | `LILYGO_TTGO_LORA32` | esp32 |
| M5Stack | Atom | `M5STACK_ATOM` | esp32 |
| M5Stack | AtomS3 Lite | `M5STACK_ATOMS3_LITE` | esp32s3 |
| M5Stack | NanoC6 | `M5STACK_NANOC6` | esp32c6 |
| M5Stack | NanoH2 | `M5STACK_NANOH2` | esp32h2 |
| McHobby | PYBSTICK26_ESP32C3 | `GARATRONIC_PYBSTICK26_ESP32C3` | esp32c3 |
| Olimex | ESP32 EVB | `OLIMEX_ESP32_EVB` | esp32 |
| Olimex | ESP32 POE | `OLIMEX_ESP32_POE` | esp32 |
| Seeed Studio | XIAO ESP32C3 | `SEEED_XIAO_ESP32C3` | esp32c3 |
| Seeed Studio | XIAO ESP32C5 | `SEEED_XIAO_ESP32C5` | esp32c5 |
| Seeed Studio | XIAO ESP32C6 | `SEEED_XIAO_ESP32C6` | esp32c6 |
| Seeed Studio | XIAO ESP32S3 | `SEEED_XIAO_ESP32S3` | esp32s3 |
| Silicognition LLC | ManT1S | `SIL_MANT1S` | esp32 |
| Silicognition | wESP32 | `SIL_WESP32` | esp32 |
| Soldered Electronics | NULA Mini | `SOLDERED_NULA_MINI` | esp32c6 |
| SparkFun | ESP32 / WROOM | `SPARKFUN_IOT_REDBOARD_ESP32` | esp32 |
| SparkFun | Thing Plus ESP32-C5 | `SPARKFUN_THINGPLUS_ESP32C5` | esp32c5 |
| Unexpected Maker | FeatherS2 | `UM_FEATHERS2` | esp32s2 |
| Unexpected Maker | FeatherS2 Neo | `UM_FEATHERS2NEO` | esp32s2 |
| Unexpected Maker | FeatherS3 | `UM_FEATHERS3` | esp32s3 |
| Unexpected Maker | FeatherS3 Neo | `UM_FEATHERS3NEO` | esp32s3 |
| Unexpected Maker | NanoS3 | `UM_NANOS3` | esp32s3 |
| Unexpected Maker | OMGS3 | `UM_OMGS3` | esp32s3 |
| Unexpected Maker | ProS3 | `UM_PROS3` | esp32s3 |
| Unexpected Maker | RGB Touch Mini | `UM_RGBTOUCH_MINI` | esp32s3 |
| Unexpected Maker | TinyC6 | `UM_TINYC6` | esp32c6 |
| Unexpected Maker | TinyPICO | `UM_TINYPICO` | esp32 |
| Unexpected Maker | TinyS2 | `UM_TINYS2` | esp32s2 |
| Unexpected Maker | TinyS3 | `UM_TINYS3` | esp32s3 |
| Unexpected Maker | TinyWATCH S3 | `UM_TINYWATCHS3` | esp32s3 |
| Waveshare | Waveshare ESP32-S3-Pico | `WAVESHARE_ESP32_S3_PICO` | esp32s3 |
| Wemos | C3 mini | `LOLIN_C3_MINI` | esp32c3 |
| Wemos | S2 mini | `LOLIN_S2_MINI` | esp32s2 |
| Wemos | S2 pico | `LOLIN_S2_PICO` | esp32s2 |

## Espressif ESP8266

Port: `esp8266` — 1 board.

| Supplier | Board name | Model (build target) | Chip |
|----------|-----------|----------------------|------|
| Espressif | ESP8266 | `ESP8266_GENERIC` | esp8266 |

## STMicroelectronics STM32

Port: `stm32` — 76 boards.

| Supplier | Board name | Model (build target) | Chip |
|----------|-----------|----------------------|------|
| Adafruit | F405 Express | `ADAFRUIT_F405_EXPRESS` | stm32f4 |
| Arduino | Giga | `ARDUINO_GIGA` | stm32h7 |
| Arduino | Nicla Vision | `ARDUINO_NICLA_VISION` | stm32h7 |
| Arduino | Opta WiFi | `ARDUINO_OPTA` | stm32h7 |
| Arduino | Portenta H7 | `ARDUINO_PORTENTA_H7` | stm32h7 |
| Espruino | Pico | `ESPRUINO_PICO` | stm32f4 |
| Fez | Cerb40 | `CERB40` | stm32f4 |
| George Robotics | Pyboard D-series SF2 | `PYBD_SF2` | stm32f7 |
| George Robotics | Pyboard D-series SF3 | `PYBD_SF3` | stm32f7 |
| George Robotics | Pyboard D-series SF6 | `PYBD_SF6` | stm32f7 |
| George Robotics | Pyboard Lite v1.0 | `PYBLITEV10` | stm32f4 |
| George Robotics | Pyboard v1.0 | `PYBV10` | stm32f4 |
| George Robotics | Pyboard v1.1 | `PYBV11` | stm32f4 |
| HydraBus | HydraBus v1.0 | `HYDRABUS` | stm32f4 |
| LEGO | Hub No.6 | `LEGO_HUB_NO6` | stm32f4 |
| LEGO | Hub No.7 | `LEGO_HUB_NO7` | stm32f4 |
| LimiFrog | LimiFrog | `LIMIFROG` | stm32l4 |
| McHobby | GARATRONIC_NADHAT_F405 | `GARATRONIC_NADHAT_F405` | stm32f4 |
| McHobby | GARATRONIC_PYBSTICK26_F411 | `GARATRONIC_PYBSTICK26_F411` | stm32f4 |
| MikroElektronika | MikroE Clicker 2 for STM32 | `MIKROE_CLICKER2_STM32` | stm32f4 |
| MikroElektronika | MikroE Quail | `MIKROE_QUAIL` | stm32f4 |
| Netduino | Netduino Plus 2 | `NETDUINO_PLUS_2` | stm32f4 |
| Olimex | STM32-E407 | `OLIMEX_E407` | stm32f4 |
| Olimex | STM32-H407 | `OLIMEX_H407` | stm32f4 |
| PyMateIO | GARATRONIC_PYMATE_CORE8ADI8DOSC | `GARATRONIC_PYMATE_CORE8ADI8DOSC` | stm32f4 |
| SparkFun | MicroMod STM32 | `SPARKFUN_MICROMOD_STM32` | stm32f4 |
| ST Microelectronics | B_L072Z_LRWAN1 | `B_L072Z_LRWAN1` | stm32l0 |
| ST Microelectronics | B_L475E_IOT01A | `B_L475E_IOT01A` | stm32l4 |
| ST Microelectronics | Discovery F4 | `STM32F4DISC` | stm32f4 |
| ST Microelectronics | Discovery F411 | `STM32F411DISC` | stm32f4 |
| ST Microelectronics | Discovery F429 | `STM32F429DISC` | stm32f4 |
| ST Microelectronics | Discovery F469 | `STM32F469DISC` | stm32f4 |
| ST Microelectronics | Discovery F7 | `STM32F7DISC` | stm32f7 |
| ST Microelectronics | Discovery F769 | `STM32F769DISC` | stm32f7 |
| ST Microelectronics | Discovery Kit H7 | `STM32H7B3I_DK` | stm32h7 |
| ST Microelectronics | Discovery Kit H747I | `STM32H747I_DISCO` | stm32h7 |
| ST Microelectronics | Discovery L476 | `STM32L476DISC` | stm32l4 |
| ST Microelectronics | Discovery L496G | `STM32L496GDISC` | stm32l4 |
| ST Microelectronics | Nucleo F091RC | `NUCLEO_F091RC` | stm32f0 |
| ST Microelectronics | Nucleo F401RE | `NUCLEO_F401RE` | stm32f4 |
| ST Microelectronics | Nucleo F411RE | `NUCLEO_F411RE` | stm32f4 |
| ST Microelectronics | Nucleo F412ZG | `NUCLEO_F412ZG` | stm32f4 |
| ST Microelectronics | Nucleo F413ZH | `NUCLEO_F413ZH` | stm32f4 |
| ST Microelectronics | Nucleo F429ZI | `NUCLEO_F429ZI` | stm32f4 |
| ST Microelectronics | Nucleo F439ZI | `NUCLEO_F439ZI` | stm32f4 |
| ST Microelectronics | Nucleo F446RE | `NUCLEO_F446RE` | stm32f4 |
| ST Microelectronics | Nucleo F722ZE | `NUCLEO_F722ZE` | stm32f7 |
| ST Microelectronics | Nucleo F746ZG | `NUCLEO_F746ZG` | stm32f7 |
| ST Microelectronics | Nucleo F756ZG | `NUCLEO_F756ZG` | stm32f7 |
| ST Microelectronics | Nucleo F767ZI | `NUCLEO_F767ZI` | stm32f7 |
| ST Microelectronics | Nucleo G0B1RE | `NUCLEO_G0B1RE` | stm32g0 |
| ST Microelectronics | Nucleo G474RE | `NUCLEO_G474RE` | stm32g4 |
| ST Microelectronics | Nucleo H563ZI | `NUCLEO_H563ZI` | stm32h5 |
| ST Microelectronics | Nucleo H723ZG | `NUCLEO_H723ZG` | stm32h7 |
| ST Microelectronics | Nucleo H743ZI | `NUCLEO_H743ZI` | stm32h7 |
| ST Microelectronics | Nucleo H743ZI2 | `NUCLEO_H743ZI2` | stm32h7 |
| ST Microelectronics | Nucleo H753ZI | `NUCLEO_H753ZI` | stm32h7 |
| ST Microelectronics | Nucleo H7A3ZI-Q | `NUCLEO_H7A3ZI_Q` | stm32h7 |
| ST Microelectronics | Nucleo L073RZ | `NUCLEO_L073RZ` | stm32l0 |
| ST Microelectronics | Nucleo L152RE | `NUCLEO_L152RE` | stm32l1 |
| ST Microelectronics | Nucleo L432KC | `NUCLEO_L432KC` | stm32l4 |
| ST Microelectronics | Nucleo L452RE | `NUCLEO_L452RE` | stm32l4 |
| ST Microelectronics | Nucleo L476RG | `NUCLEO_L476RG` | stm32l4 |
| ST Microelectronics | Nucleo L4A6ZG | `NUCLEO_L4A6ZG` | stm32l4 |
| ST Microelectronics | Nucleo U5A5ZJ_Q | `NUCLEO_U5A5ZJ_Q` | stm32u5 |
| ST Microelectronics | Nucleo WB55 | `NUCLEO_WB55` | stm32wb |
| ST Microelectronics | Nucleo WL55 | `NUCLEO_WL55` | stm32wl |
| ST Microelectronics | STM32F439 | `STM32F439` | stm32f4 |
| ST Microelectronics | USBDONGLE_WB55 | `USBDONGLE_WB55` | stm32wb |
| VCC-GND Studio | F407VE | `VCC_GND_F407VE` | stm32f4 |
| VCC-GND Studio | F407ZG | `VCC_GND_F407ZG` | stm32f4 |
| VCC-GND Studio | H743VI | `VCC_GND_H743VI` | stm32h7 |
| WeAct Studio | Mini STM32H723 | `WEACTSTUDIO_MINI_STM32H723` | stm32h7 |
| WeAct Studio | Mini STM32H743 | `WEACTSTUDIO_MINI_STM32H743` | stm32h7 |
| WeAct Studio | Mini STM32U585 | `WEACTSTUDIO_MINI_STM32U585` | stm32u5 |
| WeAct Studio | WeAct F411 'blackpill'. Default variant is v3.1 with no SPI Flash. | `WEACT_F411_BLACKPILL` | stm32f411 |

## Microchip SAMD (SAM D21 / D51)

Port: `samd` — 18 boards.

| Supplier | Board name | Model (build target) | Chip |
|----------|-----------|----------------------|------|
| Adafruit | Feather M0 Express | `ADAFRUIT_FEATHER_M0_EXPRESS` | samd21 |
| Adafruit | Feather M4 Express | `ADAFRUIT_FEATHER_M4_EXPRESS` | samd51 |
| Adafruit | ItsyBitsy M0 Express | `ADAFRUIT_ITSYBITSY_M0_EXPRESS` | samd21 |
| Adafruit | ItsyBitsy M4 Express | `ADAFRUIT_ITSYBITSY_M4_EXPRESS` | samd51 |
| Adafruit | Metro M4 Express Airlift | `ADAFRUIT_METRO_M4_EXPRESS` | samd51 |
| Adafruit | NeoKey Trinkey | `ADAFRUIT_NEOKEY_TRINKEY` | samd21 |
| Adafruit | QT Py - SAMD21 | `ADAFRUIT_QTPY_SAMD21` | samd21 |
| Adafruit | Trinket M0 | `ADAFRUIT_TRINKET_M0` | samd21 |
| Microchip | Generic SAMD21J18 | `SAMD_GENERIC_D21X18` | samd21 |
| Microchip | Generic SAMD51P19 | `SAMD_GENERIC_D51X19` | samd51 |
| Microchip | Generic SAMD51P20 | `SAMD_GENERIC_D51X20` | samd51 |
| Microchip | SAMD21 Xplained Pro | `SAMD21_XPLAINED_PRO` | samd21 |
| MiniFig Boards | Mini SAM M4 | `MINISAM_M4` | samd51 |
| Seeed Studio | Wio Terminal D51R | `SEEED_WIO_TERMINAL` | samd51 |
| Seeed Studio | XIAO SAMD21 | `SEEED_XIAO_SAMD21` | samd21 |
| SparkFun | SAMD51 Thing Plus | `SPARKFUN_SAMD51_THING_PLUS` | samd51 |
| SparkFun | SparkFun RedBoard Turbo | `SPARKFUN_REDBOARD_TURBO` | samd21 |
| SparkFun | SparkFun SAMD21 Dev Breakout | `SPARKFUN_SAMD21_DEV_BREAKOUT` | samd21 |

## Nordic Semiconductor nRF

Port: `nrf` — 23 boards.

| Supplier | Board name | Model (build target) | Chip |
|----------|-----------|----------------------|------|
| Actinius | Icarus | `ACTINIUS_ICARUS` | nrf91 |
| Adafruit | Feather nRF52840 Express | `FEATHER52` | nrf52 |
| Arduino | Nano 33 BLE Sense | `ARDUINO_NANO_33_BLE_SENSE` | nrf52 |
| Arduino | Primo | `ARDUINO_PRIMO` | nrf52 |
| BBC | micro:bit v1 | `MICROBIT` | nrf51 |
| Ezurio | DVK-BL652 | `DVK_BL652` | nrf52 |
| I-SYST | BLUEIO Tag EVIM | `BLUEIO_TAG_EVIM` | nrf52 |
| I-SYST | IBK BLYST Nano | `IBK_BLYST_NANO` | nrf52 |
| I-SYST | IDK BLYST Nano | `IDK_BLYST_NANO` | nrf52 |
| Makerdiary | nrf52840 MDK USB Dongle | `NRF52840_MDK_USB_DONGLE` | nrf52 |
| Nordic Semiconductor | pca10000 | `PCA10000` | nrf51 |
| Nordic Semiconductor | pca10001 | `PCA10001` | nrf51 |
| Nordic Semiconductor | pca10028 | `PCA10028` | nrf51 |
| Nordic Semiconductor | pca10031 | `PCA10031` | nrf51 |
| Nordic Semiconductor | pca10040 | `PCA10040` | nrf52 |
| Nordic Semiconductor | pca10056 | `PCA10056` | nrf52 |
| Nordic Semiconductor | pca10059 | `PCA10059` | nrf52 |
| Nordic Semiconductor | pca10090 | `PCA10090` | nrf91 |
| Particle | Xenon | `PARTICLE_XENON` | nrf52 |
| Seeed Studio | XIAO nRF52840 Sense | `SEEED_XIAO_NRF52` | nrf52 |
| u-blox | EVK-NINA-B1 | `EVK_NINA_B1` | nrf52 |
| u-blox | EVK-NINA-B3 | `EVK_NINA_B3` | nrf52 |
| Wireless-Tag | WT51822-S4AT | `WT51822_S4AT` | nrf51 |

## NXP i.MX RT

Port: `mimxrt` — 14 boards.

| Supplier | Board name | Model (build target) | Chip |
|----------|-----------|----------------------|------|
| Adafruit | Metro M7 | `ADAFRUIT_METRO_M7` | mimxrt |
| Makerdiary | iMX RT1011 Nano Kit | `MAKERDIARY_RT1011_NANO_KIT` | mimxrt |
| NXP | MIMXRT1010_EVK | `MIMXRT1010_EVK` | mimxrt |
| NXP | MIMXRT1015_EVK | `MIMXRT1015_EVK` | mimxrt |
| NXP | MIMXRT1020_EVK | `MIMXRT1020_EVK` | mimxrt |
| NXP | MIMXRT1050_EVK | `MIMXRT1050_EVK` | mimxrt |
| NXP | MIMXRT1060_EVK | `MIMXRT1060_EVK` | mimxrt |
| NXP | MIMXRT1064_EVK | `MIMXRT1064_EVK` | mimxrt |
| NXP | MIMXRT1170_EVK | `MIMXRT1170_EVK` | mimxrt |
| Olimex | RT1010-Py | `OLIMEX_RT1010` | mimxrt |
| PHYTEC | phyBOARD-RT1170 Development Kit | `PHYBOARD_RT1170` | mimxrt |
| PJRC | Teensy 4.0 | `TEENSY40` | mimxrt |
| PJRC | Teensy 4.1 | `TEENSY41` | mimxrt |
| Seeed Studio | Arch Mix | `SEEED_ARCH_MIX` | mimxrt |

## Renesas RA

Port: `renesas-ra` — 7 boards.

| Supplier | Board name | Model (build target) | Chip |
|----------|-----------|----------------------|------|
| Arduino | Portenta C33 | `ARDUINO_PORTENTA_C33` | RA6M5 |
| MikroElektronika | Mikroe RA4M1 Clicker | `RA4M1_CLICKER` | ra4m1 |
| Renesas Electronics | EK-RA4M1 | `EK_RA4M1` | ra4m1 |
| Renesas Electronics | EK-RA4W1 | `EK_RA4W1` | ra4w1 |
| Renesas Electronics | EK-RA6M1 | `EK_RA6M1` | ra6m1 |
| Renesas Electronics | EK-RA6M2 | `EK_RA6M2` | ra6m2 |
| Vekatech | VK-RA6M5 | `VK_RA6M5` | ra6m5 |

## Alif Ensemble

Port: `alif` — 1 board.

| Supplier | Board name | Model (build target) | Chip |
|----------|-----------|----------------------|------|
| Alif Semiconductor | Ensemble E7 DevKit | `ALIF_ENSEMBLE` | AE722F80F55D5XX |

## Infineon PSoC Edge

Port: `psoc-edge` — 1 board.

| Supplier | Board name | Model (build target) | Chip |
|----------|-----------|----------------------|------|
| Infineon Technologies | KIT_PSE84_AI | `KIT_PSE84_AI` | PSE846GPS2DBZC4 |

## Texas Instruments CC3200

Port: `cc3200` — 1 board.

| Supplier | Board name | Model (build target) | Chip |
|----------|-----------|----------------------|------|
| Pycom | WiPy Module | `WIPY` | cc3200 |
