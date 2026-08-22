"""Near-misses: a chained comparison, and the literal written on the left."""


def agree(left, right):
    # Three operands, not two — `left == right == True` is not `left == right`.
    if left == right == True:
        return "both"
    if None == left == right:
        return "neither"
    return "mixed"


def limits(bus):
    # The literal is on the left, so folding it would swap the order the two
    # sides are evaluated in.
    if None == bus.handle:
        return 0
    if True == bus.ready:
        return 1
    return 2
