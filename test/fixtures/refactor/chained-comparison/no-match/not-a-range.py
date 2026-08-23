"""Pairs that share a term but do not read as one range."""


def checks(a, b, c, lo, hi, value):
    # Opposite directions: `a < b > c` is legal Python and reads like a typo.
    if a < b and b > c:
        return 1
    # Equality is a different rewrite, and `a == b == c` is not always kinder.
    if a == b and b == c:
        return 2
    # Three terms — folding half of it leaves a worse-looking hybrid.
    if lo < value and value < hi and hi < 100:
        return 3
    # `or` does not chain at all.
    if lo < value or value < hi:
        return 4
    return 0
