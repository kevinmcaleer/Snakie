"""The same decoder, already taking the advice.

`view` wraps the receive buffer once, so every slice below is a window onto
memory that already exists rather than a fresh copy.
"""

import machine

uart = machine.UART(1, 115200)

rx = bytearray(128)
view = memoryview(rx)


def decode(packets):
    total = 0
    offset = 0
    for _ in range(packets):
        header = view[offset:offset + 2]
        payload = view[offset + 2:offset + 10]
        if header == b"\xa5\x5a":
            total += sum(payload)
        offset += 12
    return total
