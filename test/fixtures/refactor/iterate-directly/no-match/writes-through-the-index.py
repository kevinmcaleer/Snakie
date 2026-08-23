"""Filling a buffer is not the same as iterating its values."""


def clear(buffer):
    for i in range(len(buffer)):
        buffer[i] = 0
    return buffer


def scale(samples, gain):
    for i in range(len(samples)):
        samples[i] = samples[i] * gain
