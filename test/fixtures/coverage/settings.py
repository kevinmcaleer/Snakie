# buckets: with, try/except, nested import, dict subscript assign, early return
DEFAULTS = {"brightness": 40, "volume": 3, "name": "pico"}

settings = {}


def load(path):
    try:
        import ujson as json
    except ImportError:
        import json
    try:
        with open(path) as handle:
            return json.loads(handle.read())
    except OSError:
        return dict(DEFAULTS)


def get(key):
    if key in settings:
        return settings[key]
    return DEFAULTS[key]


def put(key, value):
    settings[key] = value
