"""A selection that starts inside an `if` and ends after it takes half a block."""

import time


def follow_line(sensors, motors):
    left, right = sensors.read()
    if left > right:
        motors.turn(-0.3)
        time.sleep_ms(30)
    motors.forward(0.5)
    time.sleep_ms(30)
