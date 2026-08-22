"""Battery and obstacle checks for the rover."""

FULL_MV = 8400
CUTOFF_MV = 6600
DEAD_ZONE_CM = 20


def is_charged(millivolts):
    if millivolts >= FULL_MV:
        return True
    else:
        return False


def needs_charge(millivolts):
    if millivolts > CUTOFF_MV:
        return False
    else:
        return True


def has_link(radio):
    if radio.peer is not None:
        return True
    else:
        return False


def is_idle(state):
    if not state.moving:
        return True
    else:
        return False


def path_clear(distance_cm, bumper):
    if distance_cm > DEAD_ZONE_CM and not bumper.value():
        return True
    else:
        return False


def blocked(distance_cm, bumper):
    if distance_cm > DEAD_ZONE_CM and bumper.value() == 0:
        return False
    else:
        return True
