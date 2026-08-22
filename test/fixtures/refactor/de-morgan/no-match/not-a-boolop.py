"""A `not` over a single test has nothing to distribute over."""


def parked(speed):
    if not (speed > 0):
        return True
    return False


def disconnected(radio):
    return not radio.connected()


def unsafe(estop):
    if not estop.value():
        return True
    return False
