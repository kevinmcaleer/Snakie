"""The same range checks, bracketed and split over lines."""


def guard(temp, lo, hi, override):
    if lo < temp < hi:
        return "ok"
    if not (lo <= temp <= hi):
        return "out"
    if override or (0 < temp < 40):
        return "warm"
    if lo < temp < hi:
        return "ok"
    return "?"
