"""Reading a config file in text mode.

`open(path)` and `open(path, "r")` hand back `str`, and `str` objects have no
`readinto()` at all — rewriting either of these would not even run.
"""


def scan_header(path, lines):
    found = 0
    with open(path) as f:
        for _ in range(lines):
            head = f.read(32)
            found += head.count("=")
    return found


def scan_body(path, lines):
    found = 0
    with open(path, "r") as f:
        for _ in range(lines):
            body = f.read(32)
            found += body.count(";")
    return found
