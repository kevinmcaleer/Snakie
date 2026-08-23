"""Deleting entries mid-iteration is already broken; that needs fixing, not tidying."""


def prune(cache):
    for key in cache.keys():
        if cache[key] is None:
            cache.pop(key)


def zero(counters):
    for name in counters.keys():
        counters[name] = 0
