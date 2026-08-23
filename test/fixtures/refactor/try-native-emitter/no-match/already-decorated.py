import micropython


@micropython.viper
def scale(buf) -> int:
    total = 0
    for i in range(len(buf)):
        total += buf[i]
    return total
