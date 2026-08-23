"""Runtime state that only looks like a constant."""

MODE = 0
STEP_DELAY_MS = 5


def set_mode(new_mode):
    global MODE
    MODE = new_mode


def slow_down():
    global STEP_DELAY_MS
    STEP_DELAY_MS = STEP_DELAY_MS * 2
