"""Encoder maths for a Pico rover: ticks in, millimetres out."""

TICKS_PER_REV = 1440
WHEEL_CIRCUMFERENCE_MM = 204
histogram = [0] * 16


def revolutions_for(distance_mm):
    """Whole wheel revolutions needed to cover `distance_mm`."""
    return int(distance_mm / WHEEL_CIRCUMFERENCE_MM)


def midpoint(left_ticks, right_ticks):
    """Halfway between the two encoders, rounded down."""
    return int((left_ticks + right_ticks) / 2)


def duty_percent(duty_u16):
    # Sitting inside a wider sum, so the rewrite keeps its own precedence.
    return int(duty_u16 / 655) + 1


def bucket(reading, band):
    return histogram[int(reading / band)]


def backlash(travel_mm):
    # A unary minus binds tighter than `//`, so this one needs its brackets.
    return -int(travel_mm / 2)


degrees_per_tick = 4 / int(TICKS_PER_REV / 360)
