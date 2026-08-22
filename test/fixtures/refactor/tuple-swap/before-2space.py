"""A two-space file, swapping the ends of a route."""


def reverse_leg(start, finish):
  spare = start
  start = finish
  finish = spare
  return start, finish
