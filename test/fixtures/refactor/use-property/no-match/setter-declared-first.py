"""`@angle.setter` needs `angle` to exist already.

Here the setter is written above the getter, so decorating it would reference a
property the class has not defined yet — a `NameError` at import time.
"""


class Servo:
    def __init__(self):
        self._angle = 0

    def set_angle(self, value):
        self._angle = value

    def get_angle(self):
        return self._angle


class Thermostat:
    def __init__(self):
        self._target = 20.0

    def set_target(self, value):
        self._target = float(value)

    def get_target(self):
        return self._target
