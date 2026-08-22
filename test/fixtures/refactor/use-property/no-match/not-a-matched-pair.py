"""Three shapes that only look like an accessor pair.

`Encoder` does real work in the getter, so its body is not a single `return`.
`Radio` reads one attribute and writes another. `Latch` ignores the value it is
handed, which means the two methods are not two halves of one attribute.
"""


class Encoder:
    def __init__(self, pin):
        self._pin = pin
        self._ticks = 0

    def get_ticks(self):
        self._ticks += self._pin.value()
        return self._ticks

    def set_ticks(self, value):
        self._ticks = value


class Radio:
    def __init__(self):
        self._rx_channel = 1
        self._tx_channel = 1

    def get_channel(self):
        return self._rx_channel

    def set_channel(self, value):
        self._tx_channel = value


class Latch:
    def __init__(self):
        self._state = False

    def get_state(self):
        return self._state

    def set_state(self, value):
        self._state = True
