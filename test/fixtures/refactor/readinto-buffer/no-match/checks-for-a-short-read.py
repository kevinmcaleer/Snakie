"""Telemetry link drain.

Both loops ask "did I actually get anything?" — and that answer is exactly what
changes when you swap `read()` for `readinto()`, so leave them alone.
"""

from machine import UART

link = UART(1, 115200)


def pump(handler):
    while True:
        packet = link.read(16)
        if packet is None:
            continue
        handler(packet)


def drain_file(path, blocks):
    seen = 0
    with open(path, "rb") as f:
        for _ in range(blocks):
            chunk = f.read(64)
            if len(chunk) < 64:
                break
            seen += 1
    return seen
