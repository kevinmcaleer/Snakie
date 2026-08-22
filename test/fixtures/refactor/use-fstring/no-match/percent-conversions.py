"""Conversions an f-string cannot reproduce faithfully.

`%d` truncates: `"%d" % 3.7` prints `3`, where `f"{3.7}"` prints `3.7` and
`f"{3.7:d}"` raises. `%.2f`, `%x` and a literal `%%` are all outside what this
rule translates, so it says nothing about any of them.
"""


def ticks(count):
    print("tick %d" % count)


def battery(millivolts):
    return "%d mV" % millivolts


def charge(percent):
    return "battery %.1f%% remaining" % percent


def address(register):
    return "reg 0x%x" % register


def padded(minutes, seconds):
    return "%02d:%02d" % (minutes, seconds)
