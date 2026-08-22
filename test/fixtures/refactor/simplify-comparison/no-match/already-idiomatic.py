"""Nothing here to simplify — this is the shape the rule aims at."""

import time


def poll(sensor, deadline):
    if sensor is None:
        return None
    while not sensor.ready:
        if time.ticks_ms() > deadline:
            return None
        time.sleep_ms(5)
    return sensor.read()


def label(reading):
    if reading is not None and reading > 0:
        return "live"
    if reading == 0:
        return "idle"
    return "unknown"
