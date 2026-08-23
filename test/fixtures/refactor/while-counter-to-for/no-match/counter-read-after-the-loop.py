"""The while leaves `i == count`; `range` would leave `i == count - 1`."""


def first_gap(distances, count):
    i = 0
    while i < count:
        if distances[i] > 500:
            break
        i += 1
    print("stopped at", i)
    return i
