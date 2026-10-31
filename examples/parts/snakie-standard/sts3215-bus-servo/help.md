# Feetech STS3215 Bus Servo

A smart servo on a shared serial bus. Each servo has an ID, a 12-bit magnetic
encoder (360°), and reports its position, speed, load, voltage and temperature.
The Open Duck Mini uses 14 of the **7.4 V** version (the 12 V version is a
different part).

## Wiring

Each servo has two identical 3-pin ports, so servos daisy-chain. Connect one
port to a bus adapter and chain the rest.

| Servo pin | Connect to |
|-----------|-----------|
| D (data) | the adapter's D (half-duplex TTL serial) |
| V | servo supply, 6–8.4 V (a 2S Li-ion pack) |
| G | GND, shared with the controller |

Don't connect D straight to a microcontroller TX/RX pair. The bus is
half-duplex, so it needs an adapter such as the Waveshare Bus Servo Adapter.

## Python

From a Raspberry Pi or PC, with the adapter on USB:

```python
from scservo_sdk import PortHandler, sms_sts

port = PortHandler('/dev/ttyACM0')
port.openPort(); port.setBaudRate(1_000_000)
servo = sms_sts(port)
servo.WritePosEx(1, 2048, 1500, 50)   # id 1 to centre, speed, accel
print(servo.ReadPos(1))
```

Every servo ships as ID 1. Set unique IDs one servo at a time before chaining
them.

## Links

- [Waveshare ST3215 wiki (SDK, manual)](https://www.waveshare.com/wiki/ST3215_Servo)
- [Feetech](https://www.feetechrc.com/)
- [Open Duck Mini](https://github.com/apirrone/Open_Duck_Mini)
