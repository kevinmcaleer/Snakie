import micropython


@micropython.native
def mix(buf):
    """Integer loop work with nothing the native emitter cannot compile."""
    total = 0
    for i in range(len(buf)):
        total += buf[i]
    return total
