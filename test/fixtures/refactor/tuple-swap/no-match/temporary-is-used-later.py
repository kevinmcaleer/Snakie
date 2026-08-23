"""The scratch variable is read after the swap, so it is not a temporary."""


def swap_and_log(a, b):
    previous = a
    a = b
    b = previous
    print("channel a was", previous)
    return a, b
