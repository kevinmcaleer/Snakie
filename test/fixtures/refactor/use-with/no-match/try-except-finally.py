"""A `try` with an `except` clause is not a plain `finally: close()` pair.

Turning it into a `with` block would have to keep the handler as well, which is
a bigger rewrite than this rule promises — so it declines.
"""


def load_settings(path):
    f = open(path)
    try:
        return f.read()
    except OSError:
        return ""
    finally:
        f.close()


def stream(path, sink):
    f = open(path, "rb")
    try:
        sink.write(f.read())
    finally:
        f.close()
        sink.flush()
