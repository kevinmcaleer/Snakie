# "cruise" turns up three times, but as a dict value, as one side of an ==, and
# as a bare argument. Nothing there says what it is, and CRUISE = "cruise" is
# the literal spelled twice rather than a name, so the rule keeps quiet.
DEFAULTS = {"mode": "cruise", "trim": 0}


def announce(mode, link):
    if mode == "cruise":
        link.write("cruise")
    return DEFAULTS
