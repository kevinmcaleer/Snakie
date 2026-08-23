"""A `for … else` runs extra code when the loop finishes; `sum()` cannot."""


def guarded_total(readings):
    total = 0
    for reading in readings:
        total += reading
    else:
        print("all readings counted")
    return total
