"""Only one sequence is indexed — that is `enumerate`, not `zip`."""


def dump(samples):
    for i in range(len(samples)):
        print(samples[i])


def total(readings):
    running = 0
    for i in range(len(readings)):
        running += readings[i]
    return running
