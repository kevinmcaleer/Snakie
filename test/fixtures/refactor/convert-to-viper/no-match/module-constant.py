from micropython import const

_STEPS = const(8)


def crc8(seed, byte):
    """`_STEPS` is a module global, which viper can only reach as an object."""
    crc = seed ^ byte
    for _ in range(_STEPS):
        crc = (crc << 1) & 0xFF
    return crc
