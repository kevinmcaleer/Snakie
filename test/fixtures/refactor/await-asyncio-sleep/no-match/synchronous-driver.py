"""A blocking driver with no event loop in sight — sleeping here is correct."""
import time
from machine import I2C, Pin

i2c = I2C(0, scl=Pin(5), sda=Pin(4))
ADDR = 0x76


def reset():
    i2c.writeto_mem(ADDR, 0xE0, b"\xb6")
    time.sleep(0.05)


def read_calibration():
    reset()
    time.sleep_ms(2)
    return i2c.readfrom_mem(ADDR, 0x88, 24)


class Barometer:
    def measure(self):
        i2c.writeto_mem(ADDR, 0xF4, b"\x25")
        time.sleep_ms(10)
        return i2c.readfrom_mem(ADDR, 0xF7, 3)
