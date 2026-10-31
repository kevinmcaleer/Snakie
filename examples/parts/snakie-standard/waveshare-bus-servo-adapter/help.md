# Waveshare Bus Servo Adapter (A)

Connects a computer or microcontroller to Feetech/Waveshare serial bus servos
(STS/SCS series, such as the STS3215). It turns USB-C or a TTL UART into the
servos' half-duplex bus and passes servo power through.

## Jumpers

| Position | Use |
|----------|-----|
| **A** | UART header (TX/RX/GND) drives the servos, e.g. from a Pico or a Pi's GPIO UART |
| **B** | USB-C drives the servos, e.g. from a Raspberry Pi or PC (the Open Duck Mini uses this) |

## Wiring

| Adapter | Connect to |
|---------|-----------|
| D V G ports | servo ports (D to D, V to V, G to G) |
| DC jack or DC+ / DC- | servo supply. Match the servos' voltage, e.g. 7.4 V for STS3215 7.4 V |
| TX / RX (jumper A) | the controller's RX / TX (crossed), GND to GND |
| USB-C (jumper B) | the computer |

Servo V comes straight from the supply, so the supply voltage must suit the
servos.

## Links

- [Waveshare wiki](https://www.waveshare.com/wiki/Bus_Servo_Adapter_(A))
- [STS3215 servo](https://www.waveshare.com/wiki/ST3215_Servo)
