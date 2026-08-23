"""A closure that already exists reads the ENCLOSING function's variable.

`show` was defined before the last two lines, so it closes over `run_state`
here — not over a new function's local. Move those lines out and `show()` would
print the old value, because the caller only gets the new one back after the
call returns.
"""


def announce(log):
    run_state = "idle"

    def show():
        log.write(run_state + "\n")

    run_state = "driving"
    show()
