"""A float total that is added to twice, by hand, outside any loop."""

WHEELBASE_MM = 148.0


def turning_radius(left_ticks, right_ticks):
    total = 0.0
    total += left_ticks
    total += right_ticks
    return total * WHEELBASE_MM / 2
