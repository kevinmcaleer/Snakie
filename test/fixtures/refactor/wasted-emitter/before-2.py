import micropython


def make_scaler(gain):
    """`gain` lives in a cell, and the emitter still has to chase the pointer."""

    @micropython.native
    def scale(reading):
        return reading * gain

    return scale


@micropython.viper
def log_all(*readings):
    """Every call packs the arguments into a tuple before viper ever runs."""
    total = 0
    for reading in readings:
        total += reading
    return total
