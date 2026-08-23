"""Someone left a note in the dead code, so it is not ours to delete."""


def calibrate(sensor):
    sensor.reset()
    return sensor.read()
    sensor.read()
    # Kept on purpose: the old two-pass calibration we may need again.
    sensor.read()
