"""The loop count and the indexed sequences are unrelated, so `zip` would guess."""


def pair_up(lefts, rights, limit):
    for i in range(limit):
        print(lefts[i], rights[i])


def partial(samples, times):
    for i in range(len(samples) // 2):
        print(samples[i], times[i])
