import micropython


def reflect(value: int) -> int:
    return ((value & 0x0F) << 4) | ((value >> 4) & 0x0F)


@micropython.viper
def crc16(seed: int, data: int) -> int:
    """Not a leaf — it calls back into Python, so assembly buys nothing."""
    crc = seed ^ (data << 8)
    for _ in range(8):
        crc = (crc + int(reflect(crc & 0xFF))) & 0xFFFF
    return crc
