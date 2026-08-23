def windows(buf, size):
    total = 0
    for i in range(len(buf) - size):
        total += buf[i]
        yield total
