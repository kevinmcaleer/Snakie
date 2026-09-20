# buckets: class, @property getter and setter, self.x, class constant
class Thermostat:
    STEP = 0.5

    def __init__(self, target):
        self._target = target
        self.heating = False

    @property
    def target(self):
        return self._target

    @target.setter
    def target(self, value):
        self._target = value

    def update(self, reading):
        if reading < self._target - self.STEP:
            self.heating = True
        elif reading > self._target + self.STEP:
            self.heating = False
        return self.heating


room = Thermostat(19.5)
room.target = 21.5
print(room.target, room.update(18.4))
