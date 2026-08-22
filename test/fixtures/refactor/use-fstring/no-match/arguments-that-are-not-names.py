"""Only a bare name or a dotted attribute may go inside a replacement field.

A call would move work into the string; arithmetic would need parentheses the
rule is not going to reason about; and a subscript with a quoted key is the
MicroPython trap this whole caveat exists for — `f"{readings["left"]}"` is a
syntax error on the board, because its parser predates PEP 701.
"""

import time


def stamped(event):
    return "%s: %s" % (time.ticks_ms(), event)


def pair(readings):
    return "{} / {}".format(readings["left"], readings["right"])


def numbered(index, total):
    return "step {} of {}".format(index + 1, total)


def slice_of(buffer):
    return "head %s" % buffer[:4]
