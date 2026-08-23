"""Battery telemetry for the rover's status LED."""

from machine import Pin

lamp = Pin(25, Pin.OUT)


def levels(codes):
    out = []
    for code in codes:
        if code == 1:
            level = "low"
        elif code == 2:
            level = "mid"
        elif code == 3:
            level = "high"
        else:
            level = "off"
        out.append(level)
    return out
