"""Two different values are being checked, so there is nothing to combine."""


def can_compare(left, right):
    if isinstance(left, int) or isinstance(right, int):
        return True
    return isinstance(left, str) or isinstance(right, str)
