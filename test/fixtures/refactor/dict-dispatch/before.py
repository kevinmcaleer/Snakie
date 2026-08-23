"""Drive-mode helpers for the Snakie rover."""

from machine import PWM, Pin


def duty_for_mode(mode):
    if mode == "crawl":
        return 12000
    elif mode == "cruise":
        return 32000
    elif mode == "sprint":
        return 58000
    else:
        return 0


def status_colour(state):
    if state == "idle":
        colour = (0, 32, 0)
    elif state == "moving":
        colour = (0, 0, 64)
    elif state == "fault":
        colour = (64, 0, 0)
    else:
        colour = (16, 16, 0)
    return colour


def drive(mode, state):
    left = PWM(Pin(14))
    right = PWM(Pin(15))
    left.duty_u16(duty_for_mode(mode))
    right.duty_u16(duty_for_mode(mode))
    return status_colour(state)
