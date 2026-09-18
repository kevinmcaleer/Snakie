# buckets: nested import, try/except, with, method call on an object
try:
    import ujson as json
except ImportError:
    import json


def load(path):
    with open(path) as handle:
        return json.loads(handle.read())


def save(path, data):
    with open(path, "w") as handle:
        handle.write(json.dumps(data))
