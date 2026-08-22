"""A method: a class body is not a scope, so a sibling `def` would be invisible.

Extracting from here needs the `self.…` call form and a collision check over the
whole class, which is a different refactoring — rule 8 declines instead.
"""

from machine import PWM, Pin


class Servo:
    def __init__(self, pin):
        self.pwm = PWM(Pin(pin))
        self.pwm.freq(50)
        self.angle = 0

    def write(self, angle):
        span = 8000 - 1600
        duty = 1600 + int(span * angle / 180)
        self.pwm.duty_u16(duty)
        self.angle = angle
