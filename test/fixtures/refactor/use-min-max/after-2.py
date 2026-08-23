"""A two-space file, a chained subscript and a computed iterable."""


def brightest(frame):
  return max(frame.pixels)


def dimmest_channel(rows):
  return min(rows)[2]


def quietest(radio):
  return min(radio.scan(), key=lambda ap: ap[3])
