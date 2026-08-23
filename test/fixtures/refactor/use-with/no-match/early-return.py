"""A `return` between the open and the close already skips the close.

Rewriting this to a `with` block would *fix* that leak rather than preserve it,
so the rule declines and leaves the decision to the person holding the board.
"""


def read_first_line(path):
    f = open(path)
    line = f.readline()
    if not line:
        return None
    f.close()
    return line.strip()


def flash_firmware(path, flash):
    image = open(path, "rb")
    header = image.read(16)
    if header[:4] != b"UF2\n":
        raise ValueError("not a UF2 image")
    flash.write(image.read())
    image.close()
