"""The body also jumps the counter, so it is not a plain 0..n-1 walk."""


def scan(bus, count):
    i = 0
    while i < count:
        if bus.probe(i):
            i = count
        i += 1


def stride(frames, count, step):
    i = 0
    while i < count:
        frames[i].draw()
        i += step
        i += 1
