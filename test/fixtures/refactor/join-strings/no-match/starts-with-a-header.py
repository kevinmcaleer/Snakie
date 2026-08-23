"""The accumulator does not start empty, so `join` would drop the header."""


def csv_file(rows):
    text = "index,value\n"
    for row in rows:
        text += row
    return text
