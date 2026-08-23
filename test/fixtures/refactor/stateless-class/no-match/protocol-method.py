"""A dunder is a protocol slot — the class exists so the syntax works.

`scale(2)` reaches `__call__` and `ramp[3]` reaches `__getitem__` only because
they are methods on a type. Neither has any state, and neither can be a plain
function without the call site changing shape entirely.
"""


class Scale:
    def __call__(self, value):
        return value * 2


class Ramp:
    def __init__(self):
        pass

    def __getitem__(self, index):
        return index * index
