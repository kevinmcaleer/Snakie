"""A `continue` sends control back to the top by another route."""

import time


def follow_line(rover, sensors):
    while True:
        if sensors.lost():
            break
        if sensors.centred():
            rover.forward(40)
            continue
        rover.nudge(sensors.error())
        time.sleep_ms(20)
    rover.stop()
