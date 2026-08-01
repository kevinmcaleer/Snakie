import time
import instruments as inst
from machine import I2C, Pin
from bme280 import BME280

# I2C0 on a Pico-family board (RP2040 / RP2350): GP12 = SDA, GP13 = SCL.
# Other MCUs put different GPIOs behind the same silk names — a XIAO ESP32-S3's
# Grove port is Pin(5)/Pin(6). Check your board's pinout before copying these.
i2c = I2C(0, sda=Pin(12), scl=Pin(13))
bme = BME280(i2c)
inst.start()
inst.watch(weather=bme)     # → SNK BIND weather env (lights up this barometer)
while True:
    inst.update()           # → SNK ENV weather <t> <p> <h>
    time.sleep(1)
