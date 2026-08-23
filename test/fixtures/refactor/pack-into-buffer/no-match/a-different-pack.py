"""A `pack()` that has nothing to do with `struct` — a Tk-style layout helper."""
from display import Label, pack

ROWS = ("battery", "heading", "range")


def build(screen):
    for name in ROWS:
        pack(Label(screen, name), side="top")
