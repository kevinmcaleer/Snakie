"""An `elif` shares the chain above it, and a comment would be deleted."""


def is_hot(celsius):
    if celsius is None:
        return False
    elif celsius > 40:
        return True
    else:
        return False


def is_level(pitch_deg):
    if abs(pitch_deg) < 2:
        # The IMU jitters by about a degree even on a flat bench.
        return True
    else:
        return False
