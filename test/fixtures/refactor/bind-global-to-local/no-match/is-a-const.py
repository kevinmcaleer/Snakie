from micropython import const

THRESHOLD = const(500)


def scan(samples):
    hits = 0
    for sample in samples:
        if sample > THRESHOLD:
            hits += 1
        elif sample == THRESHOLD:
            hits += 1
    return hits
