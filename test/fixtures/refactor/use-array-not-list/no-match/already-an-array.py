"""The same tables, already stored as arrays.

The list literals here are only the initialiser handed to `array()`; the object
that survives the import is the array, so there is nothing left to say.
"""

from array import array

GAMMA = array("B", [0, 1, 2, 4, 7, 11, 17, 25, 36, 50, 68, 91, 119, 154, 196, 246])

SWEEP = array("H", [1500, 1587, 1673, 1757, 1837, 1913, 1983, 2048, 2106, 2156])

history = array("h", [0] * 64)


def trace(samples):
    """A long numeric display that is never bound to a name at all."""
    return samples.extend([0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
