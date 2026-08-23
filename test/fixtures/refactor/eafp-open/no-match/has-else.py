"""The else branch is the 'file was missing' path — where it belongs in a
try/except is the author's call, not ours."""

import os


def load_or_seed(path, seed):
    if os.path.exists(path):
        with open(path) as f:
            return f.read()
    else:
        with open(path, "w") as f:
            f.write(seed)
        return seed
