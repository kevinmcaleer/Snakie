# buckets: global, in / not in, subscript assign, early return
STATES = ["idle", "walking", "sleeping"]

state = "idle"
counts = {}


def enter(name):
    global state
    if name not in STATES:
        return False
    state = name
    counts[name] = counts.get(name, 0) + 1
    return True


def seen(name):
    return name in counts
