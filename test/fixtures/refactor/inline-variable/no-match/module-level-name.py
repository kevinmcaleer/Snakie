"""A module-level name is part of what the file hands out — one file cannot
prove that nothing imports it, so only locals are inlined."""

sda = 12
scl = 13
divider = 3.0

i2c = I2C(0, sda=Pin(sda), scl=Pin(scl))
volts = raw * divider
