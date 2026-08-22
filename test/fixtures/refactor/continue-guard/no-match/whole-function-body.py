def read_sensor(bus):
    if bus is not None:
        raw = bus.read()
        return raw / 16


class Encoder:
    def update(self, ticks):
        if ticks > 0:
            self.total += ticks
            self.last = ticks
