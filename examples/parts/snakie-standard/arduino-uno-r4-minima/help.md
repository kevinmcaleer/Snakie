# Arduino UNO R4 Minima

The UNO in its R4 form: a **Renesas RA4M1** (Arm Cortex-M4, 48 MHz, 256 KB flash,
32 KB RAM) with the classic UNO header layout and **5 V** I/O, a USB-C socket and a
barrel jack. Shields made for the UNO R3 fit.

## Pins

The GPIO number is the Arduino pin number (`D7` is 7, `A0`–`A5` are 14–19).

| Pins | What they do |
|------|--------------|
| **D0 / D1** | `Serial1` RX / TX (SCI2). USB serial is separate, so these stay free |
| **D3, D5, D6, D9, D10, D11** | PWM (`~` on the silk) |
| **D10–D13** | SPI: SS, COPI, CIPO, SCK (also on the 6-pin SPI/ICSP header) |
| **A0–A5** | analog inputs, up to 14-bit. **A0 is also a 12-bit DAC** (true analog out) |
| **SDA / SCL** | I²C (`Wire`), the same pins as **A4 / A5** |
| **D13** | the onboard **L** LED |
| **VIN** | 6–24 V in (the barrel jack feeds it too), stepped down to 5 V by a buck converter |
| **BOOT** | pull low at reset to enter the RA4M1 bootloader |

⚠️ The RA4M1 pins are rated for only **8 mA** each — much less than the R3. Drive
LEDs through a resistor sized for that, and anything bigger through a transistor.

## 3D model

The model is Arduino's official STEP (`PCB(ABX00080).step` from the board's CAD
files, CC BY-SA 4.0), converted to STL by `scripts/arduino-uno-meshes.mjs`; the
tiny resistors and capacitors are simplified to blocks to keep the file small.

## Links

- [UNO R4 Minima docs](https://docs.arduino.cc/hardware/uno-r4-minima/) ·
  [full pinout (PDF)](https://docs.arduino.cc/resources/pinouts/ABX00080-full-pinout.pdf) ·
  [datasheet](https://docs.arduino.cc/resources/datasheets/ABX00080-datasheet.pdf)
