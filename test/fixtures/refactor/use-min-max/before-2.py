"""A two-space file, a chained subscript and a computed iterable."""


def brightest(frame):
  return sorted(frame.pixels)[-1]


def dimmest_channel(rows):
  return sorted(rows)[0][2]


def quietest(radio):
  return sorted(radio.scan(), key=lambda ap: ap[3])[0]
