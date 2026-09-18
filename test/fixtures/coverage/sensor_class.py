# buckets: class, methods, self.x assign, try/except, raise
from machine import I2C


class Barometer:
    ADDRESS = 0x77

    def __init__(self, i2c):
        self.i2c = i2c
        self.calibrated = False

    def read(self):
        try:
            data = self.i2c.readfrom_mem(self.ADDRESS, 0xF7, 6)
        except OSError:
            raise RuntimeError("barometer did not answer")
        return data

    def calibrate(self):
        self.calibrated = True
