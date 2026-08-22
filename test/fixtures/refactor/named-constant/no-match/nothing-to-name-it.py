# 750 turns up three times in three unrelated roles - an argument here, a
# subtraction there, a return value at the end. Nothing in the code says what it
# is, and MAGIC_1 would not say it either, so the rule stays quiet.
import time


def settle(bus):
    time.sleep_ms(750)
    return bus.read()


def remaining(elapsed):
    return 750 - elapsed


def budget():
    return 750
