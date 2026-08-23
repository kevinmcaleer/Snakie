"""The accumulator is rebound inside the loop, so its start value is not the 0.0."""
import time


def windowed_mean(readings, window):
    total = 0.0
    means = []
    for n, value in enumerate(readings):
        total += value
        if (n + 1) % window == 0:
            means.append(total / window)
            total = 0.0
        time.sleep_ms(1)
    return means
