"""A `keys` attribute that is not the dictionary method we mean."""


def sorted_names(servos):
    for name in sorted(servos.keys()):
        print(name)


def dump(table):
    for column in table.keys:
        print(column)
