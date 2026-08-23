"""Index 1 is skipped, so the names do not line up with the sequence."""


def endpoints(track):
    start = track[0]
    finish = track[2]
    return start, finish


def offset_pair(window):
    left = window[1]
    right = window[2]
    return left, right
