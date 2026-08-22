"""Shapes we decline: a one-line body, and a check partway down an elif chain."""

import os


def read_first(paths):
    for path in paths:
        if os.path.exists(path): return open(path).read()
    return ""


def pick_source(mode, path):
    if mode == "memory":
        return None
    elif os.path.exists(path):
        with open(path) as f:
            return f.read()
    return ""
