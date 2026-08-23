# The branches do not all test the same thing the same way: one compares a
# different name, and one is a range test rather than an equality.


def gear_for(speed, load):
    if speed == 0:
        return "park"
    elif load == 1:
        return "tow"
    elif speed > 40:
        return "high"
    else:
        return "low"
