"""The dead assignment is what makes `counter` local to the function, so the
live `print` above it raises UnboundLocalError today. Deleting the dead line
would make that `print` start reading the global instead - a different program,
even though the one it replaces is buggy."""

counter = 0


def show_counter():
    print(counter)
    return
    counter = 1
