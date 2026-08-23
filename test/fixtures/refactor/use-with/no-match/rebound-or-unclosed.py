"""Two near-misses: a handle that gets rebound, and one that is never closed."""


def rotate(path, reopen):
    f = open(path, "rb")
    old = f.read()
    f = reopen(path)
    f.close()
    return len(old)


def tail(path):
    f = open(path)
    lines = f.readlines()
    return lines[-1]
