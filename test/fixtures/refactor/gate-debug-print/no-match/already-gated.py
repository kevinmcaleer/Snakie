"""The advice, already taken — the print is behind a flag."""

from time import sleep_ms

DEBUG = False


def follow(sensors, motors):
    while True:
        error = sensors.left() - sensors.right()
        if DEBUG:
            print("error", error)
        motors.steer(error)
        sleep_ms(10)
