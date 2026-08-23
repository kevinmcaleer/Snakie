"""The same range checks, bracketed and split over lines."""


def guard(temp, lo, hi, override):
    if (lo < temp) and (temp < hi):
        return "ok"
    if not (lo <= temp and temp <= hi):
        return "out"
    if override or (0 < temp and temp < 40):
        return "warm"
    if lo < temp and \
       temp < hi:
        return "ok"
    return "?"
