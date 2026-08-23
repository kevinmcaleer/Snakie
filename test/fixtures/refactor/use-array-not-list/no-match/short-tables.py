"""Small fixed tables.

Four corners and six trim values: the pointer overhead is a few dozen bytes,
and an array would cost more in imported code than it saves.
"""

CORNERS = [0, 90, 180, 270]
TRIM = [-2, 0, 3, 1, -1, 2]
DUTY = [0] * 4


def corner(index):
    return CORNERS[index % len(CORNERS)] + TRIM[index % len(TRIM)]
