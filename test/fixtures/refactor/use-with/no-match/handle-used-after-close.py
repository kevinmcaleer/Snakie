"""The handle is still read after the close, so it must stay in scope as it is."""


def append_row(row):
    f = open("readings.csv", "a")
    f.write(row)
    f.close()
    print("wrote", row, "to", f.name)


def rewind(path):
    data = open(path, "rb")
    blob = data.read()
    data.close()
    return blob, data.name
