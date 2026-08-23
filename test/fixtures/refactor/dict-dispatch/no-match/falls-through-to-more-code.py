# A `return` chain with no `else`, but code below it. Returning the lookup
# straight away would skip the calibration pass an unknown mode relies on.
import time


def settle_time(mode, chassis):
    if mode == "crawl":
        return 900
    elif mode == "cruise":
        return 450
    elif mode == "sprint":
        return 120
    chassis.calibrate()
    time.sleep_ms(50)
    return 0
