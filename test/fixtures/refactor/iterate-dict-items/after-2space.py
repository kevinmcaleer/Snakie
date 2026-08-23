"""A two-space file, both shapes of the rewrite."""


def detach_all(servos):
  for name, value in servos.items():
    value.detach()


def list_names(servos):
  for name in servos:
    print(name)
