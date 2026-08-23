def total_by_key(table, keys):
    """`table[key]` is a dictionary lookup — there is no pointer to cast."""
    total = 0
    for key in keys:
        total = total + table[key]
    return total
