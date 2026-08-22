"""Drive the rover until something tells it to stop."""

import time

from machine import Pin

button = Pin(16, Pin.IN, Pin.PULL_UP)


def patrol(rover, sonar):
    while sonar.distance_cm() >= 15:
        rover.forward(40)
        time.sleep_ms(50)
    rover.stop()


def countdown(display, seconds):
    while seconds > 0:
        display.show(seconds)
        time.sleep(1)
        seconds -= 1
    display.clear()


def wait_for_release(poll_ms):
    while button.value() != 1:
        time.sleep_ms(poll_ms)
