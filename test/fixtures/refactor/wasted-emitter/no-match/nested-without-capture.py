import micropython

STEP = 4


def build():
    """`advance` is nested but captures nothing — `STEP` is a module global."""

    @micropython.native
    def advance(position):
        total = 0
        for _ in range(STEP):
            total += position
        return total

    return advance
