"""Mix a stereo sample buffer down to mono."""

import micropython


@micropython.native
def mix(buf):
    total = 0
    for i in range(len(buf)):
        total += buf[i]
    return total


def run(frames):
    for frame in frames:
        mix(frame)
