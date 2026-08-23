import micropython
@micropython.viper
def gamma(level: int, gamma_x100: int) -> int:
  step = 0
  out = 0
  while step < level:
    out = out + gamma_x100
    step = step + 1
  return out >> 8
