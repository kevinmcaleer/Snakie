"""Drive-mode helpers for the Snakie rover."""

from machine import PWM, Pin


_MODE_TABLE = {
    "crawl": 12000,
    "cruise": 32000,
    "sprint": 58000,
}


def duty_for_mode(mode):
    return _MODE_TABLE.get(mode, 0)


_STATE_TABLE = {
    "idle": (0, 32, 0),
    "moving": (0, 0, 64),
    "fault": (64, 0, 0),
}


def status_colour(state):
    colour = _STATE_TABLE.get(state, (16, 16, 0))
    return colour


def drive(mode, state):
    left = PWM(Pin(14))
    right = PWM(Pin(15))
    left.duty_u16(duty_for_mode(mode))
    right.duty_u16(duty_for_mode(mode))
    return status_colour(state)
