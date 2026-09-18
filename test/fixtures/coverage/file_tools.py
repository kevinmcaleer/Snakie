# buckets: with, try/except, os module calls, .append(), early return
import os


def listing(path):
    out = []
    for name in os.listdir(path):
        out.append(name)
    return out


def read_text(path):
    try:
        with open(path) as handle:
            return handle.read()
    except OSError:
        return None


def remove(path):
    if path not in listing("/"):
        return False
    os.remove(path)
    return True
