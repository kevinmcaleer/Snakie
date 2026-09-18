# buckets: class header, method, self.x assign, self.x.y() call, docstring
from machine import Pin, PWM


class Motor:
    """One brushed motor on an H-bridge."""

    def __init__(self, forward, backward):
        self.forward = PWM(Pin(forward))
        self.backward = PWM(Pin(backward))
        self.forward.freq(1000)
        self.backward.freq(1000)
        self.speed = 0

    def drive(self, speed):
        self.speed = speed
        if speed > 0:
            self.forward.duty_u16(speed)
            self.backward.duty_u16(0)
        else:
            self.forward.duty_u16(0)
            self.backward.duty_u16(-speed)

    def stop(self):
        self.drive(0)
