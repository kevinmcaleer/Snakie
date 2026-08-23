"""`load_config(path)` is a call, not a dictionary we can name twice."""


def dump(path):
    for key in load_config(path).keys():
        print(key)


def sample(rows):
    for name in rows[0].keys():
        print(name)
