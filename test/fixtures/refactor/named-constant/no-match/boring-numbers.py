# Nothing here is magic: 0, 1, 2 and 100 read as themselves, and the counts
# inside range() describe the shape of the loop rather than a setting.
import time


def wiggle(servo):
    for _ in range(4):
        servo.value(1)
        time.sleep(1)
        servo.value(0)
        time.sleep(1)


def percent(done, total):
    if total == 0:
        return 0
    return done * 100 // total


def steps(count):
    for i in range(4):
        yield i * 2
    for j in range(count, 4):
        yield j * 2
