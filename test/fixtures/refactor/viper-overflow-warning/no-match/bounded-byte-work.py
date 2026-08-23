import micropython


@micropython.viper
def crc8(seed: int, data: int) -> int:
    """Dallas 1-Wire CRC — every intermediate stays inside eight bits."""
    crc = seed ^ data
    for _ in range(8):
        if crc & 1:
            crc = ((crc >> 1) ^ 0x8C) & 0xFF
        else:
            crc = (crc >> 1) & 0xFF
    return crc
