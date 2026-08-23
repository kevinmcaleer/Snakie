"""The `if` belongs to an inner function's own parameter of the same name, so
the outer flag is not the one being switched on."""


def make_logger(radio, verbose=False):
    prefix = "rover"

    def emit(message, verbose):
        if verbose:
            radio.send(prefix + ": " + message)
        else:
            radio.send(message)

    return emit


def scale(readings, invert=True):
    return [(-value if invert else value) for value in readings]
