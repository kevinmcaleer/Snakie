# BME280 Demo
from machine import Pin, I2C
from bme280 import BME280

# I2C0 on a Pico-family board (RP2040 / RP2350): GP12 = SDA, GP13 = SCL.
# Other MCUs put different GPIOs behind the same silk names — a XIAO ESP32-S3's
# Grove port is Pin(5)/Pin(6). Check your board's pinout before copying these.
sda = Pin(12)
scl = Pin(13)
id = 0

i2c = I2C(id=id, sda=sda, scl=scl)

bme = BME280(i2c)

print(bme.read())
