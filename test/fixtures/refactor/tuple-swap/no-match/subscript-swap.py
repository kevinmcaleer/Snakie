"""`values[i]` is a `__getitem__` call, so we will not evaluate it twice."""


def bubble_pass(values):
    for i in range(len(values) - 1):
        if values[i] > values[i + 1]:
            tmp = values[i]
            values[i] = values[i + 1]
            values[i + 1] = tmp
    return values
