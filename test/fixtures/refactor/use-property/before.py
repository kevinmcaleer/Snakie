"""Pan-tilt bracket driver."""

from machine import PWM, Pin


class Servo:
    """One hobby servo on a PWM pin."""

    def __init__(self, pin_no):
        self._pwm = PWM(Pin(pin_no))
        self._pwm.freq(50)
        self._angle = 0

    def get_angle(self):
        return self._angle

    def set_angle(self, value):
        self._angle = min(max(value, 0), 180)

    def write(self):
        self._pwm.duty_u16(1638 + int(self._angle * 45.5))


class Rover:
    def __init__(self):
        self._speed = 0
        self._heading = 0.0

    def get_speed(self):
        return self._speed

    def set_speed(self, value):
        self._speed = max(-100, min(100, value))

    def get_heading(self):
        return self._heading * 1.0

    def set_heading(self, degrees):
        self._heading = degrees % 360
