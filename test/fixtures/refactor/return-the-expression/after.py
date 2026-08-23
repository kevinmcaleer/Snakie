"""Battery and obstacle checks for the rover."""

FULL_MV = 8400
CUTOFF_MV = 6600
DEAD_ZONE_CM = 20


def is_charged(millivolts):
    return millivolts >= FULL_MV


def needs_charge(millivolts):
    return millivolts <= CUTOFF_MV


def has_link(radio):
    return radio.peer is not None


def is_idle(state):
    return not state.moving


def path_clear(distance_cm, bumper):
    return distance_cm > DEAD_ZONE_CM and not bumper.value()


def blocked(distance_cm, bumper):
    return distance_cm <= DEAD_ZONE_CM or bumper.value() != 0
