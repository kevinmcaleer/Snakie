"""A new list every pass is deliberate — one shared list would be a bug."""


def group_rows(grid):
    for row in grid:
        cells = []
        for value in row:
            cells.append(value * 2)
        print(cells)


def tally(events):
    for event in events:
        counts = {}
        counts[event] = 1
        print(counts)
