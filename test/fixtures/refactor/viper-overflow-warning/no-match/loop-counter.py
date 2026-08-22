import micropython


@micropython.viper
def settle(threshold: int) -> int:
    """`i` is a loop counter bounded by the test it is compared against."""
    i = 0
    while i < threshold:
        i += 1
    return i
