"""The three parts do not line up: a different key, a different mapping, and a
different name assigned in each branch."""


def wrong_key(config, name, fallback_name):
    if name in config:
        value = config[fallback_name]
    else:
        value = 0
    return value


def wrong_mapping(config, defaults, name):
    if name in config:
        value = defaults[name]
    else:
        value = 0
    return value


def wrong_target(config, name):
    value = None
    if name in config:
        value = config[name]
    else:
        fallback = 0
        value = fallback
    return value
