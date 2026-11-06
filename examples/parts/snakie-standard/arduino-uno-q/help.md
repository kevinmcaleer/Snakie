# Arduino UNO Q

Two computers on one UNO board: a **Qualcomm QRB2210** running Debian Linux
(quad-core Arm Cortex-A53, 2 GB or 4 GB RAM, Wi-Fi and Bluetooth) and an
**STM32U585** microcontroller (Arm Cortex-M33, 160 MHz) that drives the UNO
headers in real time. It has an **8 × 13 LED matrix**, a **Qwiic** connector and
one USB-C port for power, data and video. The 2 GB (ABX00162) and 4 GB
(ABX00173) boards share this pinout.

## Pins

The headers belong to the STM32U585. The GPIO number is the Arduino pin number
(`D7` is 7, `A0`–`A5` are 14–19, and the top-row SDA / SCL are D20 / D21).

| Pins | What they do |
|------|--------------|
| **D0 / D1** | USART1 RX / TX |
| **D3, D5, D6, D9, D10, D11** | PWM (`~` on the silk) |
| **D10–D13** | SPI2: SS, MOSI, MISO, SCK (shared with the JSPI header) |
| **D4 / D5** | can also be CAN TX / RX (FDCAN1) |
| **A0–A5** | analog inputs; **A0 and A1 are also DACs** (DAC0 / DAC1) |
| **SDA / SCL** (top row) | I²C2 — a **separate** bus from A4 / A5 on this board |
| **A4 / A5** | I²C3 SDA / SCL |
| **QWIIC** | I²C4, **3.3 V** |
| **VIN** | 7–24 V in, stepped down to 5 V (no barrel jack on this board) |
| **IOREF** | 3.3 V — the I/O voltage |

⚠️ The I/O is **3.3 V logic**. Used as digital inputs most pins tolerate 5 V,
but **D3** (PB0) does not, **A0 and A1** never do, and **no pin does while it is
used as an analog input** (A0–A5) — keep those under 3.3 V. The JCTL header (Linux console and boot
pins) is **1.8 V** logic and is not drawn on this part.

## 3D model

The model is Arduino's official STEP (`UNO Q simplified.stp`, CC BY-SA 4.0 — the
only model Arduino publishes for this board, so the parts are simple blocks),
converted to STL by `scripts/arduino-uno-meshes.mjs`.

## Links

- [UNO Q docs](https://docs.arduino.cc/hardware/uno-q/) ·
  [full pinout (PDF)](https://docs.arduino.cc/resources/pinouts/ABX00162-full-pinout.pdf) ·
  [datasheet](https://docs.arduino.cc/resources/datasheets/ABX00162-datasheet.pdf)
