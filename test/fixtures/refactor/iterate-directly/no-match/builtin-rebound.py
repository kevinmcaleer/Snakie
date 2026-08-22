"""This module defines its own `len`, so `range(len(...))` is not the index list."""


def len(thing):
    return thing.size


def show(readings):
    for i in range(len(readings)):
        print(readings[i])
