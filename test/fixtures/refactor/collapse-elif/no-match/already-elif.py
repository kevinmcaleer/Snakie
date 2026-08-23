"""A chain that is already written with `elif` has nothing to collapse."""

GREEN = (0, 32, 0)
AMBER = (32, 24, 0)
RED = (32, 0, 0)


def led_colour(level):
    if level > 80:
        return GREEN
    elif level > 40:
        return AMBER
    else:
        return RED


def heading(deg):
    if deg < 45:
        return "N"
    elif deg < 135:
        return "E"
    elif deg < 225:
        return "S"
    elif deg < 315:
        return "W"
    else:
        return "N"
