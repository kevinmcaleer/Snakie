"""A 4096-entry table: one big allocation is the wrong trade on a Pico."""


def gamma_table():
    table = []
    for step in range(4096):
        table.append(step * step // 4096)
    return table


def sine_table():
    table = []
    for step in range(0, 3600):
        table.append(step // 10)
    return table
