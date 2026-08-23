"""An attribute may be inlined only when nothing at all runs in between."""


class Servo:
    def __init__(self, low, high):
        self.low = low
        self.high = high

    def middle(self):
        return self.low + (self.high - self.low) // 2

    def clamp(self, value):
        return min(value, self.high)
