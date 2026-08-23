"""A two-space file, splitting a radio packet."""


def split(packet):
  header, payload = packet
  return header, payload
