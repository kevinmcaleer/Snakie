# BNO055 9-DOF Absolute Orientation (Bosch BNO055)

An accelerometer, gyroscope and magnetometer with Bosch's sensor fusion running
on the chip, so it hands you orientation (Euler angles or a quaternion) directly.
I²C, 3.3–5 V. This is the balance sensor in the Open Duck Mini.

## Wiring

| BNO055 pin | Board pin |
|-----------|-----------|
| Vin | 3V3 (or 5 V, the board has its own regulator) |
| GND | GND |
| SDA | SDA (I²C) |
| SCL | SCL (I²C) |
| ADR | leave open for address 0x28, tie to 3V3 for 0x29 |
| RST, INT, PS0, PS1 | leave unconnected |

3vo is the board's own 3.3 V output (up to about 50 mA). Don't feed power into it.

## MicroPython

```python
from machine import I2C, Pin
from bno055 import BNO055

i2c = I2C(0, sda=Pin(4), scl=Pin(5), freq=100_000)  # Pico pins: GP4/GP5; check your board
imu = BNO055(i2c)
print(imu.euler())        # (heading, roll, pitch) in degrees
print(imu.quaternion())
```

Copy `bno055.py` and `bno055_base.py` from the MicroPython driver into `lib/`.
The BNO055 stretches the I²C clock. Keep the bus at 100 kHz, and on a Raspberry
Pi set `dtparam=i2c_arm_baudrate=10000` or use the CircuitPython driver, which
handles it.

## Links

- [Datasheet (Bosch)](https://www.bosch-sensortec.com/products/smart-sensor-systems/bno055/)
- [Adafruit product page and guide](https://www.adafruit.com/product/2472)
- [CircuitPython driver](https://github.com/adafruit/Adafruit_CircuitPython_BNO055)
- [MicroPython driver](https://github.com/micropython-IMU/micropython-bno055)
