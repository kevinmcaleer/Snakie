"""Literals whose quoting the rewrite must not second-guess.

A bytes literal is not a str, a raw literal changes what a backslash means, a
triple-quoted block carries its own newlines, and two adjacent literals are one
string only after the parser has folded them together.
"""

HEADER = """
timestamp,{},{}
"""


def csv_header(left, right):
    return HEADER.format(left, right)


def block(name, port):
    return """{}
listening on {}
""".format(name, port)


def frame(payload):
    return b"<%s>" % payload


def path_pattern(drive):
    return r"{}:\\logs".format(drive)


def wrapped(name, angle):
    return ("{} at " "{}").format(name, angle)
