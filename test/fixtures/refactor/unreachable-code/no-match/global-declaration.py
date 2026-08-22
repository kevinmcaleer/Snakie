"""`global` binds for the whole function, reachable or not."""

_faults = 0


def clear_faults(rover):
    rover.reset()
    return True
    global _faults
