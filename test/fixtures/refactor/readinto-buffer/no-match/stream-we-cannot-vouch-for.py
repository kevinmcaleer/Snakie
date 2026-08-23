"""Two reads that look like the smell but are not safe to rewrite.

`copy_stream` reads from whatever it was handed — it may well be a socket or a
driver of the caller's own, and neither is guaranteed to have `readinto()`.
`swallow` reads a size that is only known at run time, so there is no fixed
buffer to allocate.
"""

import machine

flash = machine.SPI(1, baudrate=4_000_000)


def copy_stream(source, sink, blocks):
    for _ in range(blocks):
        block = source.read(64)
        sink.write(block)


def swallow(size, blocks):
    total = 0
    for _ in range(blocks):
        block = flash.read(size)
        total += len(block)
    return total
