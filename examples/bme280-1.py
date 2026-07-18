# BME280 Demo
from machine import Pin, I2C
from bme280 import BME280

sda = Pin(12)
scl = Pin(13)
id = 0

i2c = I2C(id=id, sda=sda, scl=scl)

bme = BME280(i2c)

print(bme.read())
