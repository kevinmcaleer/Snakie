"""Bit-level helpers for the IR receiver, already down to viper."""

import micropython


@micropython.viper
def crc16(seed: int, data: int) -> int:
    """CCITT CRC-16 over one byte — this loop is the whole hot path."""
    crc = seed ^ (data << 8)
    for _ in range(8):
        if crc & 0x8000:
            crc = ((crc << 1) ^ 0x1021) & 0xFFFF
        else:
            crc = (crc << 1) & 0xFFFF
    return crc
