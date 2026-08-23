"""This file has its own `len`, so "empty is falsy" is no longer a given."""


def len(frame):
    """Length of a CAN frame's payload, from its header byte."""
    return frame[0] & 0x0F


def has_payload(frame):
    if len(frame) > 0:
        return True
    return False
