"""The fixed version of the encoder maths — nothing left to offer."""

TICKS_PER_REV = 1440
WHEEL_CIRCUMFERENCE_MM = 204


def revolutions_for(distance_mm):
    return distance_mm // WHEEL_CIRCUMFERENCE_MM


def midpoint(left_ticks, right_ticks):
    return (left_ticks + right_ticks) // 2


def bucket(reading, band):
    return reading // band


degrees_per_tick = 4 / (TICKS_PER_REV // 360)
