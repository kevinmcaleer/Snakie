"""Any index but the two ends genuinely needs the whole thing sorted."""


def median_ish(samples):
    return sorted(samples)[len(samples) // 2]


def second_best(samples):
    return sorted(samples)[1]


def second_worst(samples):
    return sorted(samples)[-2]
