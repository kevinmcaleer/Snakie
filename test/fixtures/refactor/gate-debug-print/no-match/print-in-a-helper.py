"""The print sits in a helper; whoever calls it decides how hot the path is."""

from time import sleep_ms


def report(label, value):
    print(label, value)


def survey(readings):
    for name in readings:
        sleep_ms(20)
