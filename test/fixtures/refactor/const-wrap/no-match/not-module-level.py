"""Constants that are not module-level bindings, where const() does not apply."""

from machine import Pin


class Stepper:
    STEPS_PER_REV = 200
    HOLD_MS = 2

    def __init__(self, step_pin):
        self.step = Pin(step_pin, Pin.OUT)


def home(limit_switch):
    MAX_TRIES = 50
    for _ in range(MAX_TRIES):
        if limit_switch.value():
            return True
    return False
