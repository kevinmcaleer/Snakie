"""A two-space file, swapping the ends of a route."""


def reverse_leg(start, finish):
  start, finish = finish, start
  return start, finish
