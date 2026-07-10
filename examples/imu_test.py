from machine import Pin, I2C
from icm20948 import ICM20948
import instruments as inst
from time import sleep

id = 0
sda = Pin(12)
scl = Pin(13)

i2c = I2C(id=id, scl=scl, sda=sda)
imu = ICM20948(i2c)

inst.start()
inst.watch(imu=imu)          # → the IMU instrument appears in the dock
while True:
    inst.update()            # streams orientation each loop
    sleep(0.05)
