"""One scratch name serving two swaps: we cannot prove either half in isolation."""


def untangle(x, y, z):
    tmp = x
    x = y
    y = tmp
    tmp = z
    z = x
    x = tmp
    return x, y, z
