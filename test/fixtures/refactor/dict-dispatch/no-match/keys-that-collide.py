# `1` and `1.0` are two branches but one dict key, so a table would quietly lose
# the second. The comment inside the second chain is another reason to decline:
# replacing those lines wholesale would delete it.


def gain_for(band):
    if band == 1:
        return 0.25
    elif band == 1.0:
        return 0.50
    elif band == 2:
        return 0.75
    else:
        return 1.0


def offset_for(band):
    if band == 1:
        return -12
    elif band == 2:
        # the middle band sits on the calibration point
        return 0
    elif band == 3:
        return 12
    else:
        return 0
