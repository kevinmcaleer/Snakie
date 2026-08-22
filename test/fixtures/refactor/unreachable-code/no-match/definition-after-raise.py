"""Legacy stepper driver, kept so old sketches still import the name."""

MAX_STEPS = 200

raise ImportError("use snakie.stepper instead")


class Stepper:
    def __init__(self, pins):
        self.pins = pins

    def step(self, count):
        for _ in range(count):
            self.pins[0].toggle()
