"""Pan-tilt bracket driver."""

from machine import PWM, Pin


class Servo:
    """One hobby servo on a PWM pin."""

    def __init__(self, pin_no):
        self._pwm = PWM(Pin(pin_no))
        self._pwm.freq(50)
        self._angle = 0

    @property
    def angle(self):
        return self._angle

    @angle.setter
    def angle(self, value):
        self._angle = min(max(value, 0), 180)

    def write(self):
        self._pwm.duty_u16(1638 + int(self._angle * 45.5))


class Rover:
    def __init__(self):
        self._speed = 0
        self._heading = 0.0

    @property
    def speed(self):
        return self._speed

    @speed.setter
    def speed(self, value):
        self._speed = max(-100, min(100, value))

    @property
    def heading(self):
        return self._heading * 1.0

    @heading.setter
    def heading(self, degrees):
        self._heading = degrees % 360
