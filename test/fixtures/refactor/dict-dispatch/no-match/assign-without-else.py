# No `else`, so an unknown mode leaves `duty` at the value set above the chain.
# `TABLE.get(mode)` would overwrite it with None, which is a different program.


def duty_for(mode):
    duty = 24000
    if mode == "crawl":
        duty = 12000
    elif mode == "cruise":
        duty = 32000
    elif mode == "sprint":
        duty = 58000
    return duty
