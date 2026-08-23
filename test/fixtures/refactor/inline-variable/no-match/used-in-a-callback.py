"""The only reader runs later, inside the timer callback — a different moment."""

from time import sleep_ms


def make_beeper(period):
    delay = period * 2

    def fire(timer):
        sleep_ms(delay)

    return fire
