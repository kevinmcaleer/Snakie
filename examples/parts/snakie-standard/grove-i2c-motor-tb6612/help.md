# Grove I²C Motor Driver (TB6612FNG)

Drives **two DC motors** or **one stepper** from a Grove I²C port. A TB6612FNG
H-bridge does the switching; an onboard MCU takes the I²C commands.

## Address

**`0x14` as shipped**, but the address is settable anywhere in `0x01–0x7F` and is
stored on the module — so a second-hand or reconfigured unit can turn up anywhere
on the bus. If a scan shows an address you can't account for, this is often it.

## It is command-driven, not register-mapped

This is the part that catches people out. You **write command bytes**; you don't
read or write registers. Probing it with a register read returns `0xFF` and looks
like a dead device even when it's working perfectly.

| Command | Bytes |
|---|---|
| Wake (not-standby) | `[0x05, 0x00]` |
| Standby | `[0x04, 0x00]` |
| Run clockwise | `[0x02, channel, speed]` |
| Run counter-clockwise | `[0x03, channel, speed]` |
| Stop (coast) | `[0x01, channel]` |
| Brake | `[0x00, channel]` |

`channel` is `0` for motor A, `1` for motor B. `speed` is `0–255`.

```python
from machine import Pin, I2C
import time

i2c = I2C(1, sda=Pin(6), scl=Pin(7), freq=100_000)
MOTOR = 0x14                       # or wherever yours scanned

def motor(ch, speed):              # speed -255..255
    cmd = 0x02 if speed >= 0 else 0x03
    i2c.writeto(MOTOR, bytes([cmd, ch, min(255, abs(speed))]))

i2c.writeto(MOTOR, bytes([0x05, 0x00]))   # wake it first, or nothing moves
motor(0, 200)
time.sleep(1)
i2c.writeto(MOTOR, bytes([0x01, 0]))      # stop
```

**Wake it before driving.** The module boots in standby and silently ignores run
commands until it gets `[0x05, 0x00]`.

## Power

Motor supply goes to the `VM` / `GND` screw terminals — **4.5 V to 13.5 V**, and
it must be a supply that can deliver the stall current of both motors. Don't try
to run motors off the Grove port's `VCC`: that's logic power, and browning it out
resets the microcontroller mid-drive.

Continuous current is **1.2 A per channel**. Small geared motors (N20 and
similar) are comfortably inside that; anything larger needs a different driver.
