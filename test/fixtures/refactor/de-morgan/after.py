"""Safety interlocks for the line-following rover."""

DEAD_ZONE_CM = 12
MAX_DUTY = 65535
RESERVED = (23, 24, 25)


def hold_position(speed, distance_cm):
    if speed != 0 or distance_cm <= DEAD_ZONE_CM:
        return False
    return True


def clamp(duty):
    while duty < 0 or duty > MAX_DUTY:
        duty = duty % (MAX_DUTY + 1)
    return duty


def needs_report(status, quiet):
    if status != "ok" or quiet:
        return True
    return False


def latched(estop, armed):
    return estop.value() != 0 and armed is not None


def live_pins(pins):
    return [p for p in pins if p.value() != 0 and p.id not in RESERVED]
