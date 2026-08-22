"""Telemetry uplink for a Pico W rover.

Every import at the top arrived from a tutorial wrapped in an ImportError
shim. None of them need it any more.
"""
import json

import struct

from time import sleep_ms, ticks_ms

PACKET = "<HHh"


def send(link, left_ticks, right_ticks, battery_mv):
    frame = struct.pack(PACKET, left_ticks, right_ticks, battery_mv)
    link.write(frame)
    link.write(json.dumps({"t": ticks_ms()}))
    sleep_ms(20)
