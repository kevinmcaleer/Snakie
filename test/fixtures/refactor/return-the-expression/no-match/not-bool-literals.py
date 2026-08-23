"""The branches return values, or the same value, not opposite booleans."""

MAX_DUTY = 65535


def duty_for(speed):
    if speed > 0:
        return MAX_DUTY
    else:
        return 0


def always_true(distance_cm):
    if distance_cm > 10:
        return True
    else:
        return True


def maybe(distance_cm):
    if distance_cm > 10:
        return True
    else:
        return None
