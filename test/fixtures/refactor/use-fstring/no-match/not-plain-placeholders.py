"""Anything but a bare `{}` is left alone.

Numbered and named fields, format specs and doubled braces all mean something
the rewrite would have to reproduce exactly, and getting that wrong is a
silently wrong line of telemetry.
"""


def swapped(left, right):
    return "{1} then {0}".format(left, right)


def named(name, angle):
    return "{who} at {deg}".format(who=name, deg=angle)


def padded(reading):
    return "{:>6}".format(reading)


def literal_braces(payload):
    return "{{{}}}".format(payload)


def too_few_arguments(a, b):
    return "{} {}".format(a)
