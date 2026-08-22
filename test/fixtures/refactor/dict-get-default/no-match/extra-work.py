"""A branch that does more than the lookup, and one that reads its mapping
through a call — neither collapses to a single `get`."""


def logged_setting(config, name):
    if name in config:
        print("using configured", name)
        value = config[name]
    else:
        value = 0
    return value


def from_store(store, name):
    if name in store.entries():
        value = store.entries()[name]
    else:
        value = 0
    return value


def three_ways(config, name):
    if name in config:
        value = config[name]
    elif name in FALLBACK:
        value = 1
    else:
        value = 0
    return value
