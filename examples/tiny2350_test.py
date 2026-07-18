from machine import Pin, I2C

# Setup I2C
sda = Pin(12)
scl = Pin(13)
id = 0

i2c = I2C(id=0, sda=sda, scl=scl)

