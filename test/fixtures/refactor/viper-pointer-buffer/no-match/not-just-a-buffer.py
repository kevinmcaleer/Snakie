def trim(samples):
    """`samples` is also appended to and iterated — we cannot call it a buffer."""
    total = 0
    for i in range(len(samples)):
        total = total + samples[i]
    samples.append(total)
    for value in samples:
        total = total - value
    return total
