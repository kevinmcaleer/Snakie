"""Dropping the brackets here would re-group the surrounding and/or."""

DEAD_ZONE_CM = 12


def can_drive(speed, distance_cm, armed):
    if not (speed == 0 and distance_cm > DEAD_ZONE_CM) and armed.value() == 1:
        return True
    return False


def stalled(rpm, load, brake):
    return brake.value() == 0 and not (rpm > 0 or load < 5)


def guarded(a, b, c):
    return not not (a == 1 and b == 2) or c == 3
