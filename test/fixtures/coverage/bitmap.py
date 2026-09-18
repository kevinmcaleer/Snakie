# buckets: subscript assign, tuple assign, augmented assign beyond +=, nested loops
WIDTH = 8
HEIGHT = 8

grid = []
for _ in range(HEIGHT):
    grid.append([0] * WIDTH)


def set_pixel(x, y, value):
    grid[y][x] = value


def flip():
    for y in range(HEIGHT):
        for x in range(WIDTH):
            grid[y][x] ^= 1


def count():
    total = 0
    for row in grid:
        for cell in row:
            total += cell
    return total
