"""The loop looks at what it has built so far, which a list of pieces cannot."""


def comma_list(names):
    line = ""
    for name in names:
        line += name if line == "" else ", " + name
    return line
