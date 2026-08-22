# The default is a `raise`, not a value. `.get` cannot raise, and swapping a
# loud failure for a silent None is exactly the kind of "fix" we refuse.


def steps_per_turn(wheel):
    if wheel == "small":
        return 240
    elif wheel == "medium":
        return 320
    elif wheel == "large":
        return 400
    else:
        raise ValueError("unknown wheel")
