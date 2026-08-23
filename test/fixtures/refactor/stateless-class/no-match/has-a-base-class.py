"""A subclass overrides something, so it cannot be lifted out of the hierarchy."""

from machine import PWM, Pin


class Servo:
    def __init__(self, pin):
        self.pwm = PWM(Pin(pin))

    def angle(self, degrees):
        self.pwm.duty_ns(500000 + int(degrees * 11111))


class ClampedServo(Servo):
    def angle(self, degrees):
        Servo.angle(self, max(-90, min(90, degrees)))
