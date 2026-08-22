"""Line-follower loop — ruff owns the unused names in here, not us.

`time` is imported and never called, and `raw` is assigned and never read.
Both are ruff's F401 and F841, complete with a fix; Snakie stays quiet so the
Problems panel shows one marker each rather than two.
"""

import time
from machine import ADC, Pin


def follow(left_sensor, right_sensor, motors):
    left = ADC(Pin(left_sensor))
    right = ADC(Pin(right_sensor))
    while True:
        raw = left.read_u16()
        error = left.read_u16() - right.read_u16()
        motors.steer(error // 512)
