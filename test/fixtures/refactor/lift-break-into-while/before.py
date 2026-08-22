"""Drive the rover until something tells it to stop."""

import time

from machine import Pin

button = Pin(16, Pin.IN, Pin.PULL_UP)


def patrol(rover, sonar):
    while True:
        if sonar.distance_cm() < 15:
            break
        rover.forward(40)
        time.sleep_ms(50)
    rover.stop()


def countdown(display, seconds):
    while True:
        if seconds <= 0:
            break
        display.show(seconds)
        time.sleep(1)
        seconds -= 1
    display.clear()


def wait_for_release(poll_ms):
    while True:
        if button.value() == 1: break
        time.sleep_ms(poll_ms)
