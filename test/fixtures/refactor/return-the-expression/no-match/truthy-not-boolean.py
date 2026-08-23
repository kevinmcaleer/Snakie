"""`return motor` would hand back the motor, not True."""


def has_motor(motor):
    if motor:
        return True
    else:
        return False


def is_armed(state):
    if state.armed and state.calibrated:
        return True
    else:
        return False


def reachable(radio):
    if radio.ping():
        return False
    else:
        return True
