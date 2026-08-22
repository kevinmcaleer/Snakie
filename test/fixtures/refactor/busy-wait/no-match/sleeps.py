import time


def wait_for_sample(ready):
    while not ready():
        time.sleep_ms(1)
    return True
