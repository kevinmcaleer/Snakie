"""Neither a chained comparison nor a bare name inverts cleanly."""

MIN_MV = 6600
MAX_MV = 8400


def out_of_band(millivolts, ready):
    if not (MIN_MV < millivolts < MAX_MV and ready):
        return True
    return False


def idle(armed, moving):
    if not (armed or moving):
        return True
    return False


def unhappy(status, retries):
    return not (0 <= retries <= 3 or status == "ok")
