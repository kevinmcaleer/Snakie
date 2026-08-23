"""Shapes with no body to insert a guard into."""

from collections import OrderedDict

collect = lambda reading, into=[]: into + [reading]

registry = OrderedDict()


def register(name, hooks={}): registry[name] = hooks


class Driver:
    def reset(self, pins=[]):
        ...

    def flush(self, queue=[]):
        pass
