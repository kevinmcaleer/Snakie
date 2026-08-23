# A parameter of a module-level function is named by its callers. This file
# happens to show one; the next file that imports `spin` may show another.
import time


def spin(motorSpeed, duration_ms=500):
    end = time.ticks_add(time.ticks_ms(), duration_ms)
    while time.ticks_diff(end, time.ticks_ms()) > 0:
        print(motorSpeed)
        time.sleep_ms(20)


spin(motorSpeed=200)
