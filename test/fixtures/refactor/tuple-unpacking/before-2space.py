"""A two-space file, splitting a radio packet."""


def split(packet):
  header = packet[0]
  payload = packet[1]
  return header, payload
