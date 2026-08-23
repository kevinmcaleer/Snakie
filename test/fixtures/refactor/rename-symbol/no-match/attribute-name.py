# `self.motorSpeed` is an attribute, not a name in any scope: the same spelling
# on a different object is a different thing, and this rule renames bindings.
class Rover:
    def __init__(self, motor):
        self.motor = motor
        self.motorSpeed = 0

    def accelerate(self, step):
        self.motorSpeed += step
        self.motor.duty_u16(self.motorSpeed)
