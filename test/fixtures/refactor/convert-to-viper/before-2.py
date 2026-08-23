def gamma(level, gamma_x100):
  step = 0
  out = 0
  while step < level:
    out = out + gamma_x100
    step = step + 1
  return out >> 8
