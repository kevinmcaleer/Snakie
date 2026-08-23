"""Already idiomatic, plus a getter that carries a decorator of its own.

A decorated method has a wrapper the rule cannot reason about — stacking
`@property` on top of `@micropython.native` would change what runs, so it
declines.
"""

import micropython


class Servo:
    def __init__(self):
        self._angle = 0

    @property
    def angle(self):
        return self._angle

    @angle.setter
    def angle(self, value):
        self._angle = value


class Ranger:
    def __init__(self):
        self._distance = 0

    @micropython.native
    def get_distance(self):
        return self._distance

    def set_distance(self, value):
        self._distance = value
