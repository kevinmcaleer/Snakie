"""The loop logs as well as collects, so it is not just a comprehension."""


def log_samples(samples, uart):
    kept = []
    for sample in samples:
        uart.write("%d\n" % sample)
        kept.append(sample)
    return kept


def drain(queue):
    drained = []
    for item in queue:
        drained.append(item)
    else:
        print("queue emptied cleanly")
    return drained
