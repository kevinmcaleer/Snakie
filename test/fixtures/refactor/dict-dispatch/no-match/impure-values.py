# A dict literal builds every value at once. These branches each talk to the
# hardware, so a table would spin all three motors the moment the module loads.
from machine import Pin


def start(mode, chassis):
    if mode == "crawl":
        return chassis.creep(Pin(14))
    elif mode == "cruise":
        return chassis.roll(Pin(15))
    elif mode == "sprint":
        return chassis.launch(Pin(16))
    else:
        return chassis.halt()
