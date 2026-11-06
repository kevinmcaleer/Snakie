# Arduino UNO R4 WiFi

The UNO R4 with radios: a **Renesas RA4M1** (Arm Cortex-M4, 48 MHz) runs your
sketch with **5 V** I/O on the classic UNO headers, and an **ESP32-S3** module
handles Wi-Fi and Bluetooth (and the USB bridge). It adds a **12 × 8 red LED
matrix**, a **Qwiic** connector, USB-C and a barrel jack.

## Pins

The GPIO number is the Arduino pin number (`D7` is 7, `A0`–`A5` are 14–19).

| Pins | What they do |
|------|--------------|
| **D0 / D1** | `Serial1` RX / TX (SCI2) |
| **D3, D5, D6, D9, D10, D11** | PWM (`~` on the silk) |
| **D10–D13** | SPI: SS, COPI, CIPO, SCK (also on the 6-pin ICSP header) |
| **A0–A5** | analog inputs, up to 14-bit. **A0 is also a 12-bit DAC** |
| **SDA / SCL** | I²C (`Wire`), the same pins as **A4 / A5** |
| **QWIIC** | a separate I²C bus (`Wire1`), **3.3 V only** |
| **D13** | the onboard **L** LED |
| **VIN** | 6–24 V in (the barrel jack feeds it too), stepped down to 5 V |
| **OFF / GND / VRTC** | the small header by the jack: short **OFF** to GND to switch the 5 V supply off; **VRTC** takes a coin cell to keep the real-time clock running |

⚠️ The RA4M1 pins are rated for only **8 mA** each. The Qwiic port and the
ESP32-S3 header are **3.3 V** — never put 5 V on them.

## 3D model

The model is Arduino's official STEP (`UNO_R4_WIFI.step`, CC BY-SA 4.0),
converted to STL by `scripts/arduino-uno-meshes.mjs`; the 96 matrix LEDs and the
tiny passives are simplified to blocks to keep the file small.

## Links

- [UNO R4 WiFi docs](https://docs.arduino.cc/hardware/uno-r4-wifi/) ·
  [full pinout (PDF)](https://docs.arduino.cc/resources/pinouts/ABX00087-full-pinout.pdf) ·
  [datasheet](https://docs.arduino.cc/resources/datasheets/ABX00087-datasheet.pdf)
