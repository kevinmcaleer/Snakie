"""An attribute may be inlined only when nothing at all runs in between."""


class Servo:
    def __init__(self, low, high):
        self.low = low
        self.high = high

    def middle(self):
        span = self.high - self.low
        return self.low + span // 2

    def clamp(self, value):
        top = self.high
        return min(value, top)
