import micropython


@micropython.viper
def rotate_left(value: int) -> int:
    """A byte rotate — the shift is masked straight back down to eight bits."""
    high = (value << 1) & 0xFF
    low = (value >> 7) & 0x01
    return high | low
