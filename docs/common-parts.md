# Common robotic parts (Snakie Standard library wishlist)

A curated list of the most commonly used parts in hobby robotics — the target set
for the Standard library. Point the [build-a-part-from-image skill](../.claude/skills/build-part-from-image/SKILL.md)
(#198) at any row to generate a Snakie part for it.

Categories match the parts library section headers (#193): **Microcontroller,
Computer, Sensor, Input, Output, Motor, Display, Communication, Power, IC**.

## Microcontrollers

| Part | Interface | Notes |
| --- | --- | --- |
| Raspberry Pi Pico / Pico W | — | RP2040, 40-pin; the W adds Wi-Fi/BLE. (shipped) |
| Raspberry Pi Pico 2 / 2 W | — | RP2350. (shipped) |
| Pimoroni Tiny 2040 / Tiny 2350 | — | castellated, compact. (shipped) |
| ESP32 DevKit / ESP32-C3 / ESP32-S3 | — | Wi-Fi + BLE. (esp32 shipped) |
| Arduino Nano / Nano RP2040 Connect | — | classic 5 V / 3.3 V footprints |
| Seeed XIAO (RP2040 / ESP32-C3 / SAMD21) | — | thumb-sized castellated |
| BBC micro:bit v2 | edge connector | nRF52833 |
| Pimoroni Servo2040 | — | RP2040 servo controller: 18 servo channels + per-channel current sensing, RGB LED, user button |

## Computers

| Part | Interface | Notes |
| --- | --- | --- |
| Raspberry Pi 5 / 4 / Zero 2 W | 40-pin GPIO | SBC; pin header matches the Pi standard |

## Sensors

| Part | Interface | Notes |
| --- | --- | --- |
| HC-SR04 ultrasonic rangefinder | TRIG / ECHO (digital) | 5 V; common distance sensor |
| VL53L0X / VL53L1X time-of-flight | I²C | mm-range ToF (vl53l0x shipped as an example) |
| MPU-6050 / MPU-9250 IMU | I²C | accel + gyro (+ mag on 9250) |
| BME280 / BMP280 | I²C / SPI | temp / pressure / humidity |
| DHT11 / DHT22 | 1-wire digital | temp + humidity |
| HC-SR501 PIR motion | digital | passive IR motion |
| TCS34725 colour sensor | I²C | RGB + clear |
| Line-follower (IR reflectance, TCRT5000) | analog / digital | array or single |
| Hall-effect / reed switch | digital | wheel-encoder / endstop |
| INMP441 I²S MEMS microphone | I²S | omnidirectional digital mic; common ESP32 audio input |

## Inputs

| Part | Interface | Notes |
| --- | --- | --- |
| Tactile push button | digital | with/without pull-up |
| Rotary encoder (EC11) | 2 × digital + button | quadrature |
| Potentiometer | analog | 10 kΩ typical |
| Joystick module (2-axis + button) | 2 × analog + digital | thumbstick |

## Outputs

| Part | Interface | Notes |
| --- | --- | --- |
| LED (5 mm / SMD) | digital / PWM | + resistor |
| NeoPixel / WS2812B strip / ring | 1-wire (data) | addressable RGB |
| Piezo buzzer (active / passive) | digital / PWM | tones |
| Relay module (1/2/4 ch) | digital | switch mains/DC loads |

## Motors & drivers

| Part | Interface | Notes |
| --- | --- | --- |
| SG90 / MG996R servo | PWM | hobby servo |
| TT / N20 gear motor | via driver | DC gear motor |
| Stepper 28BYJ-48 + ULN2003 | 4 × digital | geared stepper |
| L298N dual H-bridge | 2 × PWM + 4 × digital | DC motor driver |
| MX1508 / DRV8833 | 2 × PWM ea. | compact dual H-bridge (mx1508 example) |
| TB6612FNG | PWM + dir | efficient dual driver |
| PCA9685 | I²C | 16-ch PWM / servo driver |

## Displays

| Part | Interface | Notes |
| --- | --- | --- |
| SSD1306 OLED 128×64 / 128×32 | I²C / SPI | the staple OLED |
| SH1106 OLED | I²C | SSD1306-like |
| ST7789 / ILI9341 TFT | SPI | colour TFT |
| HD44780 16×2 LCD (+ I²C backpack) | parallel / I²C | character LCD |

## Communication

| Part | Interface | Notes |
| --- | --- | --- |
| NRF24L01+ | SPI | 2.4 GHz radio |
| HC-05 / HC-06 Bluetooth | UART | classic BT serial |
| RFID-RC522 | SPI | 13.56 MHz RFID |
| NEO-6M GPS | UART | GNSS |
| IR receiver + remote (VS1838B / TSOP38238) | digital (demodulated) | NEC / RC5 remote-control decoding |

## Power

| Part | Interface | Notes |
| --- | --- | --- |
| AMS1117 3.3 V regulator | — | LDO |
| MP1584 / LM2596 buck converter | — | step-down |
| TP4056 Li-ion charger | — | 1S charging |
| 18650 holder / battery | — | cell |

## ICs

| Part | Interface | Notes |
| --- | --- | --- |
| 74HC595 shift register | SPI-like | output expansion |
| MCP23017 GPIO expander | I²C | 16 extra GPIO |
| ADS1115 ADC | I²C | 16-bit 4-ch ADC |
| PCF8574 I/O expander | I²C | 8-bit |

---

**Shipped today:** the microcontrollers marked *(shipped)* plus the `mx1508` and
`vl53l0x` example parts. Everything else is a candidate for the skill to author and
for a maintainer to promote into the Standard library (#192/#197).
