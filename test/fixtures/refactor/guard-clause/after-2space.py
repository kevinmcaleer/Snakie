def two_space(bus):
  if bus is None:
    return
  raw = bus.read()
  return raw * 2
