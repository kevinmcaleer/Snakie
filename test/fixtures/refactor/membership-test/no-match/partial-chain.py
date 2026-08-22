"""One clause of the chain is not a comparison at all, so the chain as a whole
cannot become a single membership test."""


def should_arm(mode, override):
    if mode == "run" or mode == "test" or override:
        return True
    return False


def single_test(mode):
    if mode == "run":
        return True
    return mode in ("test", "idle")
