class Rover:
    def __init__(self, motor):
        self.motor = motor

    def stop(self, plan):
        for _ in plan:
            self.motor.stop()
