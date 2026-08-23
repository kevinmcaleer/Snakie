"""Three loops whose buffer is still in use once the loop has finished.

`read()` binds the name inside the loop, so nothing after it runs at all when
the loop turns over zero times — `UnboundLocalError`, first run, obvious. Hoist
`bytearray(n)` above the loop and the name is bound either way, so `last_frame`
would hand back twelve zero bytes as though it had read them, `checksum` would
fold a block that was never filled, and `tail` would report a clean packet that
never arrived. A crash you can debug; a plausible wrong number you cannot.
"""

import machine

imu = machine.SPI(0, baudrate=8_000_000)


def last_frame(samples):
    """The caller wants the newest reading, so the buffer outlives the loop."""
    for _ in range(samples):
        frame = imu.read(12)
        settle(frame)
    return frame


def checksum(path, blocks):
    """Same shape with a file, and a `while` instead of a `for`."""
    taken = 0
    with open(path, "rb") as f:
        while taken < blocks:
            block = f.read(64)
            taken += 1
    return sum(block) & 0xFFFF


def tail(samples):
    """The `else` clause of a `for` runs even when the body never did."""
    for _ in range(samples):
        packet = imu.read(8)
        settle(packet)
    else:
        return packet[0]
    return 0


def settle(buf):
    return buf[0]
