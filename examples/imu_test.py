from machine import Pin, I2C
from icm20948 import ICM20948
import instruments as inst
from time import sleep

id = 0
# I2C0 on a Pico-family board (RP2040 / RP2350): GP12 = SDA, GP13 = SCL.
# Other MCUs put different GPIOs behind the same silk names — a XIAO ESP32-S3's
# Grove port is Pin(5)/Pin(6). Check your board's pinout before copying these.
sda = Pin(12)
scl = Pin(13)

i2c = I2C(id=id, scl=scl, sda=sda)
imu = ICM20948(i2c)

inst.start()
inst.watch(imu=imu)          # → the IMU instrument appears in the dock
while True:
    inst.update()            # streams orientation each loop
    sleep(0.05)
