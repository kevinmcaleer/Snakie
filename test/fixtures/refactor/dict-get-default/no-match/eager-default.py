"""`dict.get` evaluates its default even on a hit, so a fallback that does work
has to stay in its `else` branch."""


def calibration(table, channel):
    if channel in table:
        offset = table[channel]
    else:
        offset = measure_offset(channel)
    return offset


def cached_reading(cache, sensor):
    if sensor in cache:
        reading = cache[sensor]
    else:
        reading = FALLBACKS[sensor]
    return reading
