def checksum(payload):
    """`payload` is a buffer, not an integer — annotating it int would break callers."""
    total = 0
    for i in range(len(payload)):
        total += payload[i]
    return total & 0xFFFF
