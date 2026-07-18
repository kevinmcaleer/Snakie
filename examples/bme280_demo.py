import time
import instruments as inst
from machine import I2C, Pin
from bme280 import BME280

i2c = I2C(0, sda=Pin(12), scl=Pin(13))
bme = BME280(i2c)
inst.start()
inst.watch(weather=bme)     # → SNK BIND weather env (lights up this barometer)
while True:
    inst.update()           # → SNK ENV weather <t> <p> <h>
    time.sleep(1)
