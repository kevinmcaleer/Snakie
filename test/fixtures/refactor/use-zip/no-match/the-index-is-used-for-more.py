"""The index itself is wanted, so there is no faithful rewrite."""


def report(names, values):
    for i in range(len(names)):
        print(i, names[i], values[i])


def deltas(samples, times):
    for i in range(len(samples) - 1):
        print(samples[i + 1] - samples[i], times[i])
