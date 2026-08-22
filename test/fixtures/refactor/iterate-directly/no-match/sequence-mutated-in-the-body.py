"""`range(len(...))` freezes the length; iterating the list does not."""


def drop_negatives(readings):
    for i in range(len(readings)):
        if readings[i] < 0:
            readings.pop()


def pad(rows, width):
    for i in range(len(rows)):
        while len(rows[i]) < width:
            rows.append(0)
