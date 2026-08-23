"""The thing being indexed is a call, so naming it twice would re-read the bus."""


def dump(bus):
    for i in range(len(bus.scan())):
        print(bus.scan()[i])


def widest(grid, row):
    for i in range(len(grid[row])):
        print(grid[row][i])
