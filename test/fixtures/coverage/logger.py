# buckets: with, try/except/finally, .append(), tuple assign, subscript assign
import time

rows = []


def record(name, value):
    rows.append((name, value))


def flush(path):
    handle = open(path, "a")
    try:
        for name, value in rows:
            handle.write("%s,%s\n" % (name, value))
    finally:
        handle.close()
    del rows[:]


def latest(name):
    found = {}
    for key, value in rows:
        found[key] = value
    return found.get(name)
