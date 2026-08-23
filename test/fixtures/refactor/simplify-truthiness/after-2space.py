"""Telemetry uplink — two-space file, with one test already under a `not`."""


def uplink(radio, outbox):
  if not outbox:
    return 0
  sent = 0
  while outbox and radio.ready:
    radio.send(outbox.pop(0))
    sent += 1
  return sent


def stalled(radio):
  return "idle" if not radio.pending else "busy"


def retry(radio):
  if not (not radio.pending):
    radio.flush()
