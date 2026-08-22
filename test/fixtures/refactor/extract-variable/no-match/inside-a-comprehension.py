"""One copy runs once per item, the other runs once — a different scope entirely."""


def make_ramp(start, gain):
    steps = [start * gain + 1 for _ in range(4)]
    return steps, start * gain + 1
