"""Nothing here is a value a repr could usefully show.

`Display` only wires up peripherals — an I2C bus and a screen driver — and
`Beeper` hides its one attribute behind a name-mangled dunder.
"""

from machine import I2C, PWM, Pin
from ssd1306 import SSD1306_I2C


class Display:
    def __init__(self, sda, scl):
        self.i2c = I2C(0, sda=Pin(sda), scl=Pin(scl))
        self.screen = SSD1306_I2C(128, 64, self.i2c)

    def clear(self):
        self.screen.fill(0)
        self.screen.show()


class Beeper:
    def __init__(self, pin_no):
        self.__pwm = PWM(Pin(pin_no))
        self.__pin_no = pin_no

    def beep(self):
        self.__pwm.freq(440)
