"""Handlers that already say what they expect."""

import ujson


def read_settings(path):
    try:
        with open(path) as f:
            return ujson.loads(f.read())
    except OSError:
        return {}
    except ValueError as err:
        print("settings are corrupt:", err)
        return {}


def read_pair(raw):
    try:
        left, right = raw.split(",")
        return int(left), int(right)
    except (ValueError, TypeError):
        return 0, 0
