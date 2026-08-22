"""Already wrapped — the rule must not stack another const() on top."""

from micropython import const

SDA_PIN = const(4)
SCL_PIN = const(5)
I2C_FREQ = const(400_000)
sample_count = 100
