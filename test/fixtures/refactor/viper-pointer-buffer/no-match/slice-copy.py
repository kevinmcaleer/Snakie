def frames(stream):
    """Slices, not element indexing — `ptr8` has nothing to say about these."""
    packet = bytearray(32)
    out = 0
    for i in range(0, 32, 4):
        packet[i : i + 4] = stream[i : i + 4]
        out = out + 4
    return out
