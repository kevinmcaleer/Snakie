"""A slice keeps several elements, so the sort is doing real work."""


def top_three(samples):
    return sorted(samples, reverse=True)[:3]


def trimmed(samples):
    return sorted(samples)[1:-1]


def every_other(samples):
    return sorted(samples)[::2]
