"""A `while … else:` would wake up, and an empty body would not parse."""

import time


def scan(radio):
    while True:
        if radio.ready():
            break
        radio.poll()
        time.sleep_ms(10)
    else:
        radio.reset()


def wait(flag):
    while True:
        if flag.is_set():
            break


def hold(estop):
    while True:
        if estop.value() == 0:
            break
        else:
            estop.log()
        time.sleep_ms(100)
