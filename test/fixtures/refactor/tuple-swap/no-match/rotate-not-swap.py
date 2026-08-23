"""A three-way rotation is not a swap: the last line takes a different value."""


def shift_left(a, b, c):
    spare = a
    a = b
    b = c
    c = spare
    return a, b, c
