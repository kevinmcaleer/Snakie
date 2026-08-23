"""Telemetry uplink — two-space file, with one test already under a `not`."""


def uplink(radio, outbox):
  if not len(outbox) > 0:
    return 0
  sent = 0
  while len(outbox) != 0 and radio.ready:
    radio.send(outbox.pop(0))
    sent += 1
  return sent


def stalled(radio):
  return "idle" if len(radio.pending) == 0 else "busy"


def retry(radio):
  if not len(radio.pending) == 0:
    radio.flush()
