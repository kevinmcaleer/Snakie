"""`reverse` decided at runtime, or hidden in a dict, could mean either end."""


def pick(samples, newest_first):
    return sorted(samples, reverse=newest_first)[0]


def best(samples, options):
    return sorted(samples, **options)[0]
