"""One-shot header split.

These slices run once when a packet arrives, not on every pass of a loop, so
the copy costs a few microseconds and nothing else.
"""

packet = bytearray(24)


def split():
    head = packet[0:4]
    body = packet[4:20]
    tail = packet[20:24]
    return head, body, tail
