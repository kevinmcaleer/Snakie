"""A settings file written whole, outside every loop."""
import json

DEFAULTS = {"rate_hz": 100, "channels": 3}


def save(settings):
    with open("settings.json", "w") as handle:
        handle.write(json.dumps(settings))
        handle.flush()


def restore():
    with open("settings.json") as handle:
        return json.loads(handle.read())


def reset():
    save(DEFAULTS)
