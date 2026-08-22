"""A two-space file, both shapes of the rewrite."""


def detach_all(servos):
  for name in servos.keys():
    servos[name].detach()


def list_names(servos):
  for name in servos.keys():
    print(name)
