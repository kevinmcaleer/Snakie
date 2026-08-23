def blit(source):
    """A straight copy with no arithmetic — the subscripts are the whole cost."""
    target = bytearray(64)
    for i in range(64):
        target[i] = source[i]
    return target
