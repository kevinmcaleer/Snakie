"""Snapshots of the servo frame buffer.

`frame[:]` is the copy idiom, written on purpose: each snapshot has to survive
the next write into `frame`, so a view would be exactly the wrong answer.
"""

frame = bytearray(32)


def snapshots(rounds):
    history = []
    for _ in range(rounds):
        history.append(frame[:])
    return history
