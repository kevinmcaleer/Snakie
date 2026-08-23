"""A non-empty default may be a deliberate shared table — we do not touch it.

Reallocating `[0] * 8` on every call changes how much RAM the function costs,
which is the author's decision to make, not ours.
"""


def mix_channels(values, gains=[1.0, 1.0, 1.0, 1.0]):
    return [v * g for v, g in zip(values, gains)]


def clear_frame(buf=[0] * 8):
    for i in range(len(buf)):
        buf[i] = 0
    return buf
