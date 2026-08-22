"""Classes with no `__init__` of their own to read attributes from.

`Pins` is a namespace of constants and `Calibration` builds its instances in a
classmethod, so there is no `self.x = …` for the rule to work from.
"""


class Pins:
    LEFT_MOTOR = 16
    RIGHT_MOTOR = 17
    LINE_SENSOR = 26


class Calibration:
    @classmethod
    def from_file(cls, path):
        instance = cls()
        with open(path) as f:
            instance.offset = float(f.readline())
        return instance

    def apply(self, raw):
        return raw - self.offset
