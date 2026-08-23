"""Safety interlocks for the line-following rover."""

DEAD_ZONE_CM = 12
MAX_DUTY = 65535
RESERVED = (23, 24, 25)


def hold_position(speed, distance_cm):
    if not (speed == 0 and distance_cm > DEAD_ZONE_CM):
        return False
    return True


def clamp(duty):
    while not (duty >= 0 and duty <= MAX_DUTY):
        duty = duty % (MAX_DUTY + 1)
    return duty


def needs_report(status, quiet):
    if not (status == "ok" and not quiet):
        return True
    return False


def latched(estop, armed):
    return not (estop.value() == 0 or armed is None)


def live_pins(pins):
    return [p for p in pins if not (p.value() == 0 or p.id in RESERVED)]
