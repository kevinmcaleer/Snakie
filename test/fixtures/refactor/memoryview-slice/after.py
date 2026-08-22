"""Frame decoder for the rover's telemetry link.

Packets arrive as a 2-byte header, an 8-byte payload and a 2-byte checksum, all
inside one 128-byte receive buffer that never moves.
"""

import machine

uart = machine.UART(1, 115200)

rx = bytearray(128)
scratch = bytes(16)


def decode(packets):
    """Walk the receive buffer and total the payload of every good packet."""
    total = 0
    offset = 0
    for _ in range(packets):
        header = rx[offset:offset + 2]
        payload = rx[offset + 2:offset + 10]
        if header == b"\xa5\x5a":
            total += sum(payload)
        offset += 12
    return total


def tail_parity(rounds):
    """Fold the last four bytes of the scratch block, once per round."""
    acc = 0
    while rounds > 0:
        acc ^= sum(scratch[-4:])
        rounds -= 1
    return acc
