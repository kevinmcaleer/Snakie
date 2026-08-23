"""Telemetry uplink for a Pico W rover.

Every import at the top arrived from a tutorial wrapped in an ImportError
shim. None of them need it any more.
"""
try:
    import ujson
except ImportError:
    import json

try:
    import ustruct as struct  # the shim spelling everyone copies
except ImportError:
    import struct

try:
    from utime import sleep_ms, ticks_ms
except ImportError:
    from time import sleep_ms, ticks_ms

PACKET = "<HHh"


def send(link, left_ticks, right_ticks, battery_mv):
    frame = struct.pack(PACKET, left_ticks, right_ticks, battery_mv)
    link.write(frame)
    link.write(json.dumps({"t": ticks_ms()}))
    sleep_ms(20)
