"""Defaults that are safe to share: nothing here is mutated."""

SCALE = 3.3 / 65535


def read_pack(adc, samples=8, label="pack", offsets=(0, 0, 0), scale=SCALE):
    total = 0
    for _ in range(samples):
        total += adc.read_u16()
    return label, [total * scale + o for o in offsets]


def steer(servo, angle=90, limits=None):
    if limits is None:
        limits = (0, 180)
    low, high = limits
    servo.angle(min(max(angle, low), high))
