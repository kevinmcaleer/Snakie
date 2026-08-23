"""Inlining a sensor read moves when the hardware is touched."""


def pressure(sensor):
    raw = sensor.read_u16()
    return raw * 3300 // 65535
