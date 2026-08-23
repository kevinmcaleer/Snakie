# Every value is pure and every name it reads is bound above the def, but `TRIM`
# is a module global that `calibrate()` rewrites. The chain read it fresh on each
# call; a table is built once, at import, so it would hand back the trim the
# rover started up with for ever after.

TRIM = 0


def duty_for(mode):
    if mode == "crawl":
        return 12000 + TRIM
    elif mode == "cruise":
        return 32000 + TRIM
    elif mode == "sprint":
        return 58000 + TRIM
    else:
        return 0


def calibrate(offset):
    global TRIM
    TRIM = offset
