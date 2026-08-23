"""`return` then `yield` is the empty-generator idiom, not dead code."""


def no_samples():
    """A generator that yields nothing at all."""
    return
    yield


def drain(source):
    for sample in source:
        yield sample
