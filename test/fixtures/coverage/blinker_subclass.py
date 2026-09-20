# buckets: inheritance, super(), method override, staticmethod, class attribute
from machine import Pin
import time


class Blinker:
    def __init__(self, pin):
        self.led = Pin(pin, Pin.OUT)
        self.count = 0

    def blink(self, times):
        for _ in range(times):
            self.led.value(1)
            time.sleep_ms(120)
            self.led.value(0)
            time.sleep_ms(120)
            self.count = self.count + 1


class QuietBlinker(Blinker):
    @staticmethod
    def name():
        return "quiet"

    def blink(self, times):
        super().blink(1)
        self.count = times


led = QuietBlinker(25)
led.blink(4)
print(QuietBlinker.name(), led.count)
