"""Deleting these lines would delete the comment that explains them."""

import time


def dock(rover, dock_sensor):
    while True:
        # The dock magnet reads low for a good centimetre before contact.
        if dock_sensor.value() == 0:
            break
        rover.forward(15)
        time.sleep_ms(40)
    rover.stop()


def settle(imu, tolerance):
    while True:
        if abs(imu.pitch()) < tolerance:
            break  # level enough to start the run
        imu.update()
        time.sleep_ms(20)
