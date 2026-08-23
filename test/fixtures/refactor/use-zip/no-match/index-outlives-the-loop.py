"""The index is read after the loop, and `zip` would leave nothing behind."""


def first_mismatch(expected, actual):
    i = 0
    for i in range(len(expected)):
        if expected[i] != actual[i]:
            break
    return i


def count_pairs(lefts, rights):
    seen = 0
    for i in range(len(lefts)):
        if lefts[i] == rights[i]:
            seen += 1
    print(i, seen)
    return seen
