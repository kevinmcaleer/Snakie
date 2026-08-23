"""Checks where the answer itself is the point, or the path is a different one."""

import os

TEMPLATE = "/defaults.txt"


def report(path):
    if os.path.exists(path):
        print("found", path)
        return True
    return False


def seed_from_template(path):
    if os.path.exists(TEMPLATE):
        with open(path, "w") as out:
            out.write("0\n")


def refuse_to_overwrite(path):
    if not os.path.exists(path):
        with open(path, "w") as f:
            f.write("0\n")
