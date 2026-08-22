"""The whole ordering is used, so the sort is not being thrown away."""


def ranked(samples):
    order = sorted(samples)
    return order[0], order[-1]


def leaderboard(scores):
    for place, score in enumerate(sorted(scores, reverse=True)):
        print(place, score)
