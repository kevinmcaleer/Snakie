"""Servo limits for the arm."""

MIN_US = 500
MAX_US = 2500


def in_range(pulse):
    if MIN_US < pulse < MAX_US:
        return True
    return False


def clamp(angle):
    if 0 <= angle <= 180:
        return angle
    return 0


def descending(front, middle, back):
    return front > middle > back


def settled(arm, floor):
    if arm.height > floor >= 0:
        arm.hold()
    while 0 < arm.error <= arm.tolerance:
        arm.step()


def windowed(rows, lo, hi):
    return [r for r in rows if lo <= r.value < hi]
