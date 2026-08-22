def crc16(seed, data):
    """Plain bytecode — there are two easier rungs to try before assembly."""
    crc = seed ^ (data << 8)
    for _ in range(8):
        crc = (crc << 1) & 0xFFFF
    return crc
