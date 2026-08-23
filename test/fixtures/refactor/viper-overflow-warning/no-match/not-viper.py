def scale_ticks(ticks, numerator, denominator):
    """Plain Python: these integers grow as wide as the arithmetic needs."""
    total = 0
    for tick in ticks:
        total = total + tick * numerator // denominator
    return total
