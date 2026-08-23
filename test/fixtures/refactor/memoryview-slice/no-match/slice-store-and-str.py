"""Two look-alikes that allocate nothing worth warning about.

`stage()` writes *into* the buffer — a slice store copies bytes into memory that
already exists, which is the good case. `headings()` slices a string, and a
memoryview of a `str` is not a thing.
"""

rx = bytearray(64)
LABELS = "N NEE SESSWW NW"


def stage(chunks):
    at = 0
    for chunk in chunks:
        rx[at:at + 8] = chunk
        at += 8
    return at


def headings(count):
    out = []
    for i in range(count):
        out.append(LABELS[i * 3:i * 3 + 2])
    return out
