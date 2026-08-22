"""Each clause asks about a different value, so there is no single membership test."""


def should_stop(command, mode):
    if command == "stop" or mode == "halt":
        return True
    if command != "go" and mode != "run":
        return True
    return False


def reversed_order(x):
    return 1 == x or 2 == x
