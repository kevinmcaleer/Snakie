import micropython


@micropython.viper
def brighten(frame, step: int):
    """Already walking the frame through a raw pointer."""
    buf = ptr8(frame)
    for i in range(64):
        buf[i] = (int(buf[i]) + step) & 0xFF
