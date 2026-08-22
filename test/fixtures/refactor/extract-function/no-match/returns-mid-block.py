"""A `return` inside the selection: the jump would land in the new function."""

import time


def wait_for_button(button, timeout_ms):
    deadline = time.ticks_add(time.ticks_ms(), timeout_ms)
    while time.ticks_diff(deadline, time.ticks_ms()) > 0:
        if button.value() == 0:
            time.sleep_ms(20)
            return True
    return False
