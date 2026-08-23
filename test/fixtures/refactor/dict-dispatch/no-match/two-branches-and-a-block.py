# Two branches are an if/else, not a table — and the second chain's branches do
# two things each, so there is no single value to map a key onto.


def brake_force(mode):
    if mode == "crawl":
        return 40
    else:
        return 90


def arm(mode, buzzer, led):
    if mode == "crawl":
        buzzer.freq(262)
        led.value(1)
    elif mode == "cruise":
        buzzer.freq(330)
        led.value(1)
    elif mode == "sprint":
        buzzer.freq(392)
        led.value(0)
    else:
        buzzer.freq(220)
        led.value(0)
