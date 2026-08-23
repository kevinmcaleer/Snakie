"""A comment between the `else:` and the `if` has nowhere to go."""


def mode_for(x, dead_zone):
    if abs(x) < dead_zone:
        return "idle"
    else:
        # Past the dead zone the sign of the axis picks the side.
        if x > 0:
            return "right"
        else:
            return "left"


def duty_for(speed):
    if speed == 0:
        return 0
    else:  # anything else is a real request
        if speed > 0:
            return speed
        else:
            return -speed
