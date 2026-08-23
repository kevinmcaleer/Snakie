"""Chains that mix operators, or pair the wrong operator with the wrong join —
folding either one would change what the test means."""


def busy(speed, mode):
    if speed == 0 or speed > 100:
        return True
    if mode == "run" and mode == "stop":
        return False
    return speed != 0 or speed != 100


def in_window(reading):
    return 10 < reading < 20 or reading == 99
