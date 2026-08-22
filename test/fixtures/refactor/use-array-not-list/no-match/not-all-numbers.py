"""Tables that are long enough but hold objects, not numbers.

An `array.array` can only hold one machine type, so none of these can become
one: names are strings, the gait is tuples, and the enable flags are bools.
"""

LEGS = ["fl", "fr", "rl", "rr", "hip", "knee", "ankle", "toe", "spine", "tail"]

GAIT = [
    ("hip", 1500),
    ("knee", 1700),
    ("ankle", 1450),
    ("hip", 1600),
    ("knee", 1800),
    ("ankle", 1500),
    ("hip", 1700),
    ("knee", 1750),
    ("ankle", 1550),
]

ENABLED = [True, False, True, True, False, True, True, False, True]

MIXED = [0, 1, 2, 3, "stop", 5, 6, 7, 8, 9]

slots = [None] * 12

labels = [""] * 16
