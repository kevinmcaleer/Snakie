I2C is a **two-wire** bus (SDA + SCL) shared by many devices, each with its own 7-bit address.

## Create the bus

```python
from machine import Pin, I2C

# id/bus number first, then the pins
i2c = I2C(0, sda=Pin(4), scl=Pin(5), freq=400_000)
```

The first argument is the **hardware bus number** (`0` = I2C0, `1` = I2C1). Each bus only allows certain SDA/SCL pins — check your board's pinout. Snakie's board view reads this `id` and labels the pads.

## Scan for devices

```python
print([hex(a) for a in i2c.scan()])
# e.g. ['0x3c', '0x68']
```

No addresses? Check wiring, power, and that both lines have **pull-ups** (many breakout boards include them).

## Read / write

```python
i2c.writeto(0x3c, b"\x00")
data = i2c.readfrom(0x68, 6)
i2c.writeto_mem(0x68, 0x6b, b"\x00")  # register write
```
