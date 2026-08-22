import micropython


@micropython.viper
def crc8(seed: int, byte: int) -> int:
    crc = seed ^ byte
    for _ in range(8):
        crc = (crc << 1) & 0xFF
    return crc
