"""Drive both wheels from a shared controller object."""


class Rover:
    def __init__(self, motor):
        self.motor = motor

    def drive(self, plan):
        for left, right in plan:
            self.motor.duty_u16(left)
            self.motor.duty_u16(right)
