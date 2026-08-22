"""An abstract base is the emptiest class there is, and load-bearing anyway.

`Sensor` holds no state and has exactly one method, which is the whole point: it
is the shape every sensor in the project promises to have. Lifting `read` out to
a module-level function would leave `Analog` inheriting from nothing.
"""


class Sensor:
    def read(self, pin):
        raise NotImplementedError


class Analog(Sensor):
    def read(self, pin):
        return pin.read_u16()
