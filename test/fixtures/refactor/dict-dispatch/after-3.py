"""Battery telemetry for the rover's status LED."""

from machine import Pin

lamp = Pin(25, Pin.OUT)


_CODE_TABLE = {
    1: "low",
    2: "mid",
    3: "high",
}


def levels(codes):
    out = []
    for code in codes:
        level = _CODE_TABLE.get(code, "off")
        out.append(level)
    return out
